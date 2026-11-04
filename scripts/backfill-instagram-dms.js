#!/usr/bin/env node
// Process creator DMs that arrived before the webhook was working.
//
// Meta does not replay webhooks. Every "comment X for the link" the user
// answered by hand before the subscription was fixed produced a DM that
// reached their inbox and nothing else: the article is sitting in Instagram,
// not on the reel that prompted it. This walks the inbox and puts those
// through the same pipeline a live webhook would.
//
// It reuses handleEvent rather than reimplementing the decisions, so a
// backfilled DM is judged exactly like a live one — same matcher, same strict
// reply rules (nothing is ever sent: see NEVER_REPLY below), same idempotency.
// Re-running is safe: handleEvent records each message id it has processed and
// ignores it next time.
//
// Only conversations with a creator whose reel is actually saved are touched.
// A stranger's DM would otherwise become a tray card for something the user
// never asked for.
//
// Usage:
//   node scripts/backfill-instagram-dms.js --dry-run
//   node scripts/backfill-instagram-dms.js --limit 20
//
// Requires: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID,
// IG_ACCESS_TOKEN, IG_ACCOUNT_ID, ANTHROPIC_API_KEY.

require('dotenv').config();
const { getSupabase, defaultUserId } = require('../lib/supabase');
const { handleEvent, defaultDeps } = require('../lib/instagram/capture');
const { normalizeUsername } = require('../lib/instagram/captures');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const limitArg = args.indexOf('--limit');
const LIMIT = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;

const fs = require('node:fs');
const path = require('node:path');

// Threads already walked, so a later run spends its budget on new ones. Only
// the expensive part is remembered — reading a thread. Whether a MESSAGE was
// processed is handleEvent's business, recorded in the database.
const DONE_FILE = path.join(__dirname, '..', '.instagram-backfill-threads.json');
const THREAD_PAUSE_MS = 400;

const GRAPH = `https://graph.facebook.com/${process.env.IG_GRAPH_VERSION || 'v26.0'}`;
const TOKEN = process.env.IG_ACCESS_TOKEN;
const ACCOUNT = process.env.IG_ACCOUNT_ID;
const MESSAGES_PER_THREAD = 6;

// This runs over an inbox that is weeks old. Answering a gate now, to a
// message from a fortnight ago, would be a reply out of nowhere from the
// user's account — so the backfill never speaks, whatever decide() concludes.
const NEVER_REPLY = async () => ({ ok: false, error: 'backfill never replies' });

// Meta rate-limits the whole app, not the call. Once it starts answering
// "(#4) Application request limit reached" every later request fails too, so
// this is thrown as its own kind and ends the run: retrying inside it just
// spends the next hour's budget on 403s. Seen on 2026-11-05, which is why the
// first full pass stopped after 11 messages.
class RateLimited extends Error {}

async function graph(path, params) {
  const url = new URL(`${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params || {})) url.searchParams.set(k, v);
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${TOKEN}` },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    if (/Application request limit reached|"code":\s*4\b|"code":\s*613\b/.test(body)) {
      throw new RateLimited(body);
    }
    throw new Error(`graph ${path} failed (${response.status}): ${body}`);
  }
  return response.json();
}

// Listing threads and reading one thread are separate calls on purpose: asking
// for participants AND nested messages across 25 threads makes Meta answer
// "Please reduce the amount of data you're asking for" with a 500. The light
// list is cheap; the heavy per-thread read happens only for creators whose
// reels are actually saved.
async function conversations() {
  const threads = [];
  let after = null;
  for (let page = 0; page < 20; page++) {
    const params = { platform: 'instagram', fields: 'participants', limit: '50' };
    if (after) params.after = after;
    const body = await graph(`${ACCOUNT}/conversations`, params);
    threads.push(...(body.data || []));
    after = body.paging && body.paging.cursors && body.paging.cursors.after;
    if (!after || !(body.data || []).length) break;
  }
  return threads;
}

// This edge is slow (~11s) and sometimes 500s, so one retry before giving up
// on a thread. A thread we cannot read is skipped, not fatal: the rest of the
// inbox is still worth processing.
async function threadMessages(threadId) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const body = await graph(threadId, {
        fields: `messages.limit(${MESSAGES_PER_THREAD}){id,from,created_time,message,attachments}`,
      });
      return (body.messages && body.messages.data) || [];
    } catch (err) {
      if (err instanceof RateLimited) throw err; // ends the run, not just this thread
      if (attempt === 2) { console.error(`  thread ${threadId.slice(0, 12)}… unreadable: ${err.message}`); return []; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  return [];
}

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID || defaultUserId();
  if (!userId) throw new Error('GRIMOIRE_USER_ID is required: this script must never run unscoped');
  if (!TOKEN || !ACCOUNT) throw new Error('IG_ACCESS_TOKEN and IG_ACCOUNT_ID are required');
  const sb = getSupabase();

  // Whose reels do we actually have? Everyone else's DMs are left alone.
  const saved = new Set();
  for (let from = 0; ; from += 500) {
    const { data, error } = await sb.from('items')
      .select('source_author')
      .eq('user_id', userId)
      .not('source_author', 'is', null)
      .range(from, from + 499);
    if (error) throw new Error(`select failed: ${error.message}`);
    for (const row of data || []) saved.add(normalizeUsername(row.source_author));
    if (!data || data.length < 500) break;
  }
  console.log(`${saved.size} creator handle(s) in the library`);

  let done = new Set();
  try { done = new Set(JSON.parse(fs.readFileSync(DONE_FILE, 'utf8'))); } catch { /* first run */ }

  const threads = await conversations();
  console.log(`${threads.length} conversation(s) in the inbox, ${done.size} already walked`);

  // Live matching looks back 7 days, which is right for a webhook: a DM
  // arriving now answers a comment left in the last few days. This inbox is
  // months old, and the reel that prompted a July DM was saved in July, so the
  // window is widened for the backfill only.
  const base = defaultDeps();

  // Which reel a historical DM belongs to.
  //
  // Live, the answer is "the reel whose gate we just commented". Nothing in
  // this inbox has that: these comments were left by hand, weeks ago, and
  // nobody recorded when. Left alone, the matcher falls back to the creator's
  // newest save, so every DM a creator ever sent piles onto one reel — their
  // September answer filed under the reel saved in November.
  //
  // A creator's DM answers a comment left just after the reel was saved, so
  // the right reel is their newest one saved BEFORE the DM arrived. Candidates
  // are filtered to that, and the existing matcher's "most recent wins" then
  // picks exactly it. A DM older than every saved reel by that creator matches
  // nothing and parks, which is the honest answer.
  // ...and saved not too long before it. A creator sends their freebie within
  // minutes of the comment, and the comment follows the save by days at most.
  // Without an earliest bound, every DM a creator ever sent still collapses
  // onto whichever of their reels happens to be the newest one that predates
  // it: 30 matched captures landed on 11 reels in the first run. A DM with no
  // reel saved in the fortnight before it parks as no_match, which is the
  // honest answer — better an empty tray card than someone else's article
  // filed under this reel.
  const NEAREST_SAVE_MS = 14 * 24 * 60 * 60 * 1000;
  let messageAt = Infinity;
  const deps = {
    ...base,
    sendReply: NEVER_REPLY,
    recentInstagramItems: async (uid, options = {}) => {
      const all = await base.recentInstagramItems(uid, { ...options, days: 400 });
      return all.filter((item) => {
        const saved = Date.parse(item && item.created_at);
        if (Number.isNaN(saved)) return false;
        return saved <= messageAt && saved >= messageAt - NEAREST_SAVE_MS;
      });
    },
  };
  let processed = 0; const outcomes = {};

  let rateLimited = false;
  const save = () => { try { fs.writeFileSync(DONE_FILE, JSON.stringify([...done])); } catch { /* best effort */ } };

  for (const thread of threads) {
    if (processed >= LIMIT || rateLimited) break;
    const them = (thread.participants && thread.participants.data || [])
      .find((p) => String(p.id) !== String(ACCOUNT));
    const handle = normalizeUsername(them && them.username);
    if (!handle || !saved.has(handle)) continue;
    if (done.has(thread.id)) continue;

    // Oldest first, so a thread's messages are replayed in the order they
    // happened — the same order a webhook would have delivered them.
    let fetched;
    try {
      fetched = await threadMessages(thread.id);
    } catch (err) {
      if (!(err instanceof RateLimited)) throw err;
      console.error('\nMeta is rate-limiting the app. Stopping here — the threads already '
        + 'walked are remembered, so running this again later picks up where it left off.');
      rateLimited = true;
      break;
    }
    await new Promise((r) => setTimeout(r, THREAD_PAUSE_MS));
    const messages = [...fetched].reverse();
    for (const message of messages) {
      if (processed >= LIMIT) break;
      if (!message.from || String(message.from.id) === String(ACCOUNT)) continue; // ours, not theirs
      const event = {
        sender: { id: String(them.id) },
        timestamp: Date.parse(message.created_time) || undefined,
        message: {
          mid: message.id,
          text: message.message || '',
          attachments: (message.attachments && message.attachments.data) || [],
        },
      };
      if (DRY_RUN) {
        console.log(`  would process @${handle} ${message.created_time}`);
        processed += 1;
        continue;
      }
      // Read by the candidate filter above, which cannot see the event.
      messageAt = Date.parse(message.created_time) || Infinity;
      try {
        const action = await handleEvent(event, {
          userId,
          deps: { ...deps, lookupUsername: async () => ({ ok: true, username: handle }) },
        });
        const label = `${action.kind}${action.reason ? `(${action.reason})` : ''}`;
        outcomes[label] = (outcomes[label] || 0) + 1;
        console.log(`  @${handle} ${message.created_time} — ${label}`);
      } catch (err) {
        outcomes.error = (outcomes.error || 0) + 1;
        console.error(`  @${handle} ${message.created_time} — failed: ${err.message}`);
      }
      processed += 1;
    }

    done.add(thread.id);
    save();
  }
  save();

  console.log(`\nmessages processed: ${processed}`);
  console.log(`threads walked in total: ${done.size}${rateLimited ? ' (stopped early: rate limit)' : ''}`);
  for (const [label, n] of Object.entries(outcomes)) console.log(`  ${label}: ${n}`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
