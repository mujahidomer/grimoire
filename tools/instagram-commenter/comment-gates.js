#!/usr/bin/env node
// The bot that leaves the keyword.
//
// No Instagram API can comment on someone else's post, so this is the one step
// that needs a logged-in browser. It does not need a person: a browser profile
// signed in once holds the session the way Chrome does, and this drives real
// Chrome against it on a timer.
//
//   node comment-gates.js --login      once, by hand: sign in, then close
//   node comment-gates.js --dry-run    open each reel, find the box, type nothing
//   node comment-gates.js              post, default 8, then stop
//
// Flags: --count <n>  --min-wait <s>  --max-wait <s>  --item <id>
//
// WHAT IT REFUSES TO DO
//
// Instagram action-blocks an account that comments too fast, and an action
// block is days of nothing, not a retry. So: a small batch per run, a long
// random wait between comments, and the moment a block, a checkpoint or a
// login wall appears the whole run stops and says so. Nothing here retries
// into a refusal — that is how a slow day becomes a locked account.
//
// Requires SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GRIMOIRE_USER_ID, read
// from grimoire's .env two directories up. Every read and write is scoped to
// that user: the items table holds a dozen testers.

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright-core');

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i === -1 ? fallback : args[i + 1];
};
const LOGIN = args.includes('--login');
const DRY_RUN = args.includes('--dry-run');
const ONE_ITEM = flag('--item');
const COUNT = Number(flag('--count', 8));
const MIN_WAIT_S = Number(flag('--min-wait', 90));
const MAX_WAIT_S = Number(flag('--max-wait', 420));

// The signed-in profile. Its own directory, never the user's everyday Chrome
// profile: Chrome locks a profile while it is running, and this has to work
// whether or not they happen to have Chrome open.
const PROFILE_DIR = process.env.IG_BOT_PROFILE
  || path.join(os.homedir(), '.kitabi-instagram-profile');

const LOG_FILE = path.join(__dirname, 'runs.log');

// Written by --login, once a signed-in session is actually observed. A
// scheduled run checks for it before opening anything: the profile directory
// itself is no signal, since a single dry run creates it empty.
const SIGNED_IN_MARKER = path.join(PROFILE_DIR, '.kitabi-signed-in');

// Chrome itself, not a downloaded Chromium: it is what the account already
// signs in from, and it is far less interesting to Instagram's automation
// checks than a bundled build driven headless.
const CHROME = process.env.IG_BOT_CHROME
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const COMMENT_BOX = [
  'textarea[aria-label="Add a comment…"]',
  'textarea[placeholder="Add a comment…"]',
  'textarea[aria-label^="Add a comment"]',
  'form textarea',
];

// Any of these on the page means stop the run, not skip the reel.
const STOP_PHRASES = [
  'Action Blocked',
  'Action blocked',
  'action blocked',
  'We restrict certain activity',
  'Try Again Later',
  'try again later',
  'Please wait a few minutes before you try again',
  'Your account has been temporarily',
  'Help us confirm',
  'Suspicious Login',
];

class Stop extends Error {}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const jitter = (minS, maxS) => Math.round((minS + Math.random() * (maxS - minS)) * 1000);

function log(line) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, stamped + '\n'); } catch { /* best effort */ }
}

function shortcodeOf(url) {
  const m = String(url).match(/instagram\.com\/(?:reels?|p|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function supabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
  return createClient(url, key);
}

async function pendingGates(sb, userId) {
  let query = sb.from('items')
    .select('id,source_url,gate_keyword,source_author,title')
    .eq('user_id', userId)
    .not('gate_keyword', 'is', null)
    .is('gate_commented_at', null)
    .order('created_at', { ascending: false });
  if (ONE_ITEM) query = query.eq('id', ONE_ITEM);

  const { data, error } = await query.limit(ONE_ITEM ? 1 : COUNT * 3);
  if (error) throw new Error(`queue read failed: ${error.message}`);
  return (data || []).filter((row) => shortcodeOf(row.source_url));
}

async function openBrowser() {
  if (!fs.existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME} — set IG_BOT_CHROME`);
  }
  return chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: CHROME,
    // Never headless. Headless Chrome is the loudest automation signal there
    // is, and the account this runs as is the user's real one. The window
    // opens; from a login agent on their Mac that is fine, and when they are
    // at the keyboard they can watch it work.
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  });
}

async function assertUsable(page) {
  const url = page.url();
  if (/\/accounts\/login/.test(url)) {
    throw new Stop('signed out — run `node comment-gates.js --login` once and sign in');
  }
  if (/\/challenge|\/checkpoint/.test(url)) {
    throw new Stop('Instagram raised a checkpoint — open the profile by hand and clear it');
  }
  const body = await page.evaluate(() => document.body.innerText.slice(0, 4000)).catch(() => '');
  for (const phrase of STOP_PHRASES) {
    if (body.includes(phrase)) throw new Stop(`Instagram said "${phrase}" — stopping the run`);
  }

  // A signed-out visitor is served the post without a comment box and without
  // being redirected anywhere, so the symptom of an expired session is every
  // reel "skipped" and nothing said. Name it instead.
  const signedOut = await page.evaluate(() => {
    const prompt = document.querySelector('a[href^="/accounts/login"]');
    return Boolean(prompt) && !document.querySelector('textarea');
  }).catch(() => false);
  if (signedOut) {
    throw new Stop('the profile is not signed in — run `node comment-gates.js --login` once');
  }
}

async function commentBox(page) {
  for (const selector of COMMENT_BOX) {
    const box = page.locator(selector).first();
    if (await box.count() && await box.isVisible().catch(() => false)) return box;
  }
  return null;
}

async function commentOne(page, sb, userId, item) {
  const shortcode = shortcodeOf(item.source_url);
  // The /p/ permalink renders the classic post with the comment box inline.
  // /reel/ redirects to the full-screen player, where commenting is a panel
  // behind another click — more steps, more ways to break.
  await page.goto(`https://www.instagram.com/p/${shortcode}/`, {
    waitUntil: 'domcontentloaded', timeout: 45000,
  });
  await sleep(2500 + Math.random() * 2500);
  await assertUsable(page);

  const box = await commentBox(page);
  if (!box) {
    log(`  no comment box on ${shortcode} — comments may be off; skipped`);
    return 'skipped';
  }

  if (DRY_RUN) {
    log(`  would comment "${item.gate_keyword}" on ${shortcode} (@${item.source_author || '?'})`);
    return 'dry-run';
  }

  // Marked BEFORE posting, deliberately. These bots answer within about
  // thirty seconds, and a DM that lands before the row is written matches
  // the creator's previous reel instead — that is how an Earshot article
  // ended up filed under a Hallmark reel.
  const { error } = await sb.from('items')
    .update({ gate_commented_at: new Date().toISOString() })
    .eq('user_id', userId).eq('id', item.id);
  if (error) throw new Error(`could not mark ${item.id} commented: ${error.message}`);

  await box.click();
  await box.type(item.gate_keyword, { delay: 90 + Math.random() * 70 });
  await sleep(600 + Math.random() * 900);

  const post = page.locator('div[role="button"], button')
    .filter({ hasText: /^Post$/ }).first();
  if (await post.count()) await post.click();
  else await box.press('Enter');

  await sleep(3500);
  await assertUsable(page);

  // The box clearing is Instagram acknowledging the comment. If it still
  // holds the word, the post did not go through — the row is already marked,
  // so say so loudly rather than leaving a silent gap.
  const left = await box.inputValue().catch(() => '');
  if (left.trim()) {
    log(`  !! "${item.gate_keyword}" still in the box on ${shortcode} — marked commented but may not have posted`);
    return 'uncertain';
  }

  log(`  commented "${item.gate_keyword}" on ${shortcode} (@${item.source_author || '?'})`);
  return 'posted';
}

async function main() {
  const userId = process.env.GRIMOIRE_USER_ID;
  if (!userId) throw new Error('GRIMOIRE_USER_ID is required: this must never run unscoped');

  if (LOGIN) {
    const context = await openBrowser();
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.instagram.com/accounts/login/');
    console.log(`\nSign in in the window that opened. The session is kept in\n  ${PROFILE_DIR}\nYou can close the window once it says signed in here.\n`);

    // Watch rather than trust: the marker is only written when a signed-in
    // page is actually seen, so a window closed early leaves the scheduled
    // runs correctly inert instead of opening a browser three times a day
    // to find out.
    const deadline = Date.now() + 15 * 60 * 1000;
    let confirmed = false;
    while (Date.now() < deadline && !confirmed) {
      await sleep(5000);
      if (!context.pages().length) break;
      confirmed = await page.evaluate(() => Boolean(
        document.cookie.includes('sessionid')
        || document.querySelector('svg[aria-label="Home"], a[href="/direct/inbox/"]'),
      )).catch(() => false);
    }

    if (confirmed) {
      fs.writeFileSync(SIGNED_IN_MARKER, new Date().toISOString());
      console.log('signed in — the scheduled runs will start on their own. You can close the window.');
    } else {
      console.log('did not see a signed-in page; nothing was armed. Run --login again.');
    }
    await context.close().catch(() => {});
    return;
  }

  // Scheduled from a login agent, this runs whether or not anyone has signed
  // in yet. Opening a browser window three times a day to discover that is
  // noise, so the run ends here until the profile exists — and starts working
  // on its own the moment it does.
  if (!fs.existsSync(SIGNED_IN_MARKER)) {
    log('no signed-in profile yet — run `node comment-gates.js --login` once');
    return;
  }

  const sb = supabase();
  const queue = await pendingGates(sb, userId);
  if (!queue.length) { log('nothing pending'); return; }

  log(`run starting — ${queue.length} pending, taking up to ${COUNT}`);
  const context = await openBrowser();
  const page = context.pages()[0] || await context.newPage();

  const tally = {};
  let stopped = null;
  try {
    let done = 0;
    let skippedInARow = 0;
    for (const item of queue) {
      if (done >= COUNT) break;
      const outcome = await commentOne(page, sb, userId, item);
      tally[outcome] = (tally[outcome] || 0) + 1;

      // One reel with comments switched off is ordinary. Three in a row is
      // the account, the session or the selector — and quietly walking the
      // whole queue in that state would burn it for nothing.
      skippedInARow = outcome === 'skipped' ? skippedInARow + 1 : 0;
      if (skippedInARow >= 3) {
        throw new Stop('three reels in a row had no comment box — check the session before running again');
      }

      if (outcome === 'posted' || outcome === 'dry-run') done++;
      if (done < COUNT) await sleep(DRY_RUN ? 1500 : jitter(MIN_WAIT_S, MAX_WAIT_S));
    }
  } catch (err) {
    if (!(err instanceof Stop)) throw err;
    stopped = err.message;
  } finally {
    await context.close().catch(() => {});
  }

  log(`run finished — ${JSON.stringify(tally)}${stopped ? ` — STOPPED: ${stopped}` : ''}`);
  if (stopped) process.exit(2);
}

main().catch((err) => { log(`run failed — ${err.message}`); process.exit(1); });
