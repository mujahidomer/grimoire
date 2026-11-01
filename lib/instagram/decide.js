// The whole policy for Instagram DM capture, as one pure function.
//
// decide() takes plain objects and returns a plain object. It performs NO I/O:
// no database, no network, no filesystem, and no clock (nothing here reads the
// time; recency is the caller's job, see below). That is the point of the
// module: every rule in the feature (who may be replied to, when to give up,
// which reel an article belongs to, why a capture is parked) is testable
// without Instagram, credentials or a database. If a rule ever seems to need an
// await, the design has gone wrong; do not work around it here.
//
// `candidates` is pre-filtered by the caller to Instagram items from the last 7
// days. decide() does not filter by date or platform.
//
// Order of checks (each step is only reached when the one before did not
// decide), and why it is this order:
//
//   1. resolvedUrl present, creator matches a candidate   -> attach
//      resolvedUrl present, no match                      -> park no_match
//      A resolved article is the goal. Nothing else in the message can outrank
//      it, and matching decides only where it goes.
//   2. no resolvedUrl, but the message carried candidate links
//        a candidate is a link-in-bio hub / instagram.com -> park hub_page
//        otherwise (media file, failed wrapper, unparseable,
//        or a usable link that would not resolve)        -> park unusable_link
//      The message had a link, so it is not a gate: never reply to it. This
//      comes before the creator is looked at because a link is judged on its own
//      merits (the row exists because of the link, spec section 6).
//   3. no links at all: the message is a human DM or a bot's gate prompt.
//        sender matches no recent reel                    -> ignore
//        prompt has an allowlist word AND attempts < 2    -> reply
//        prompt names a follow                            -> park follow_gate
//        anything else                                    -> park freeform_gate
//      The sender gate comes first because it is what keeps an automated reply
//      from ever reaching a human. Reply is tried before follow_gate because
//      follow gates are mostly unenforced prose (spec risk 3), so a prompt such
//      as "follow me, then reply DONE" is usually passable by replying.

const { extractUrls, pickBestUrl, isHubPage } = require('./links');
const { normalizeUsername, NEEDS_USER_REASONS } = require('./captures');

// Task 4's normalizeUsername under the name this module's callers use. There is
// deliberately one implementation: two functions for one concept drift apart,
// and a handle compared with one rule on write and another on read matches
// nothing. Compare the result with ===, never ilike (underscores are LIKE
// wildcards, and are common in Instagram handles).
const normalizeHandle = normalizeUsername;

const [FOLLOW_GATE, FREEFORM_GATE, HUB_PAGE, UNUSABLE_LINK, NO_MATCH] = [
  'follow_gate', 'freeform_gate', 'hub_page', 'unusable_link', 'no_match',
].map((reason) => {
  // Fail at load, not in production, if the authoritative list ever changes.
  if (!NEEDS_USER_REASONS.includes(reason)) {
    throw new Error(`decide: "${reason}" is not in NEEDS_USER_REASONS`);
  }
  return reason;
});

// The only words the system will ever send (spec section 6). It never composes
// a sentence. Sent in this canonical spelling whatever case the prompt used.
const REPLY_WORDS = ['DONE', 'YES', 'SEND', 'LINK', 'GO', '✅'];
const MAX_REPLY_ATTEMPTS = 2;

const FOLLOW_PROMPT = /\bfollow(?:ing)?\b/i;

const timestampOf = (item) => {
  const t = Date.parse(item && item.created_at);
  return Number.isNaN(t) ? -Infinity : t;
};

// The most recently created candidate whose source_author is the sender, or
// null. Both sides go through normalizeHandle (case and a leading @ differ
// between Apify's ownerUsername and the DM sender) and are compared exactly.
function matchItem(candidates, senderUsername) {
  const sender = normalizeHandle(senderUsername);
  if (!sender || !Array.isArray(candidates)) return null;
  let best = null;
  for (const item of candidates) {
    if (normalizeHandle(item && item.source_author) !== sender) continue;
    if (best === null || timestampOf(item) > timestampOf(best)) best = item;
  }
  return best;
}

// The first allowlisted keyword in the prompt, in the order it was written, or
// null. Whole tokens only ("ongoing", "linked", "gone" and "v2" contain no
// keyword), and a digit counts only as a bare number ("10,000" does not).
function findReplyWord(text) {
  if (typeof text !== 'string') return null;
  const tokens = text.replace(/✅/g, ' ✅ ').split(/\s+/);
  for (const raw of tokens) {
    const token = raw.replace(/^[^\p{L}\p{N}✅]+|[^\p{L}\p{N}✅]+$/gu, '');
    if (!token) continue;
    const upper = token.toUpperCase();
    if (REPLY_WORDS.includes(upper)) return upper;
    if (/^\d+$/.test(token)) return token;
  }
  return null;
}

// Why a message that carried links produced no resolved URL. pickBestUrl is
// null for four different reasons (hub, media file, failed wrapper, unparseable)
// and "no candidates" is not one of them, so a null pick alone cannot name the
// reason. Only a hub is a hub_page; telling the user to "find the real link
// behind a Linktree" about a JPEG would be wrong.
//
// A fifth case reaches here too: a usable link WAS picked but the fetch failed
// (resolvedUrl is null for that reason as well as for a null pick). A hub link
// elsewhere in the same message is not why the capture is stuck, so that is
// unusable_link too. DO NOT "simplify" this to `urls.some(isHubPage)` alone:
// "https://example.com/guide plus https://linktr.ee/c" with an unreachable
// guide would then park as hub_page, and the tray would tell the user to go
// find the real link behind a Linktree when the article was simply unreachable.
// That is the same wrong-copy failure unusable_link exists to prevent. Pinned by
// the test 'decide parks unusable_link when the picked article url failed to resolve'.
function parkReasonForLinks(urls) {
  if (pickBestUrl(urls) !== null) return UNUSABLE_LINK;
  return urls.some(isHubPage) ? HUB_PAGE : UNUSABLE_LINK;
}

// decide({ capture, event, resolvedUrl, candidates }) -> Action
//   capture:     the dm_captures row ({ sender_username, reply_attempts, ... })
//   event:       the Meta messaging event
//   resolvedUrl: the final article URL as a string, or null (the caller has
//                already picked and resolved; this function does not fetch)
//   candidates:  recent Instagram items ({ id, source_author, created_at, ... })
//
// Action is one of:
//   { kind: 'ignore', reason }
//   { kind: 'reply',  text }
//   { kind: 'attach', itemId, url }
//   { kind: 'park',   reason }  (reason is one of NEEDS_USER_REASONS)
function decide({ capture, event, resolvedUrl, candidates } = {}) {
  const matched = matchItem(candidates, capture && capture.sender_username);

  if (resolvedUrl) {
    return matched
      ? { kind: 'attach', itemId: matched.id, url: resolvedUrl }
      : { kind: 'park', reason: NO_MATCH };
  }

  const urls = extractUrls(event);
  if (urls.length > 0) {
    return { kind: 'park', reason: parkReasonForLinks(urls) };
  }

  // A gate prompt, or a human talking. No link, so no reason to keep a row.
  if (!matched) return { kind: 'ignore', reason: 'unmatched_sender_without_link' };

  const text = event && event.message && event.message.text;
  const attempts = Number(capture.reply_attempts) || 0;
  const word = findReplyWord(text);
  if (word !== null && attempts < MAX_REPLY_ATTEMPTS) {
    return { kind: 'reply', text: word };
  }
  if (typeof text === 'string' && FOLLOW_PROMPT.test(text)) {
    return { kind: 'park', reason: FOLLOW_GATE };
  }
  return { kind: 'park', reason: FREEFORM_GATE };
}

module.exports = { decide, matchItem, normalizeHandle, REPLY_WORDS, MAX_REPLY_ATTEMPTS };
