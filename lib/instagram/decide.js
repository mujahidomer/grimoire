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
//        prompt is evidenced as a gate (see findReplyWord)
//          AND the attempt counter is a valid integer < 2  -> reply
//        prompt names a follow                            -> park follow_gate
//        anything else                                    -> park freeform_gate
//      The sender gate comes first because it is what keeps an automated reply
//      from ever reaching a human. Reply is tried before follow_gate because
//      follow gates are mostly unenforced prose (spec risk 3), so a prompt such
//      as "follow me, then reply DONE" is usually passable by replying.

const { extractUrls, pickBestUrl, isHubPage, isWrapperUrl } = require('./links');
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

// Words that tell the sender to type something back. A reply sent from the
// user's own account to a real person cannot be taken back, while a gate we
// fail to answer parks where the user can see and fix it in seconds. So a
// keyword in ordinary prose ("sure, I'll send it", "let's go", "yes, I'm 25")
// must not draw a reply; it needs evidence that the message is a gate prompt.
const INSTRUCTION_VERBS = new Set(['reply', 'send', 'type', 'comment', 'dm']);
// How many words before a keyword an instruction verb may sit ("reply with
// done", "type yes", "DM me go"). Two, not more: "I'll send you the link" has
// the verb three words back and is chatter, not a gate.
const VERB_WINDOW = 2;
// Words that, standing between a verb and a keyword, make the phrase a
// description ("send the link", "send it") rather than an instruction.
const NOT_AN_INSTRUCTION_GAP = new Set([
  'the', 'a', 'an', 'your', 'my', 'our', 'this', 'that', 'these', 'those', 'it', 'its', 'you',
]);
// A bare number is a menu choice ("reply 1"), never a code or a year.
const MENU_CHOICE = /^\d{1,2}$/;

// The word to send back, or null. One rule for everything: an allowlisted token
// qualifies only when an instruction verb sits within the 2 words before it,
// whatever its case. Case is not evidence ("LET'S GO" and "DONE" from a human
// are chatter); real gates instruct ("Reply DONE", "Comment DONE", "Type YES"),
// because instructing is their purpose. A real gate this misses parks in the
// tray and is answered in seconds; a reply to a human cannot be withdrawn.
// Loosen it only against a captured real gate, never against a guess.
//   1. the first allowlisted keyword (DONE, YES, SEND, LINK, GO, the check mark)
//      that follows an instruction verb;
//   2. only if no keyword qualified: a 1-2 digit number that follows one. So
//      "In 2026 reply DONE" answers DONE, and "I'm 25" answers nothing.
// Whole tokens only ("ongoing", "linked", "gone", "v2" contain no keyword).
// The reply is always the keyword in canonical uppercase. Quick-reply buttons
// arrive as payloads on a separate path and are not affected by this matching.
function findReplyWord(text) {
  if (typeof text !== 'string') return null;
  const tokens = text.replace(/✅/g, ' ✅ ').split(/\s+/)
    .map((raw) => raw.replace(/^[^\p{L}\p{N}✅]+|[^\p{L}\p{N}✅]+$/gu, ''))
    .filter(Boolean);
  // The nearest of the preceding words that is a verb, with no determiner or
  // pronoun between it and the keyword: "send the link" and "send it" describe
  // sending something; "reply with DONE", "type YES" and "DM me GO" instruct.
  const afterVerb = (i) => {
    for (let j = i - 1; j >= Math.max(0, i - VERB_WINDOW); j--) {
      const word = tokens[j].toLowerCase();
      if (INSTRUCTION_VERBS.has(word)) return true;
      if (NOT_AN_INSTRUCTION_GAP.has(word)) return false;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const upper = tokens[i].toUpperCase();
    if (REPLY_WORDS.includes(upper) && afterVerb(i)) return upper;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (MENU_CHOICE.test(tokens[i]) && afterVerb(i)) return tokens[i];
  }
  return null;
}

// A usable counter is a non-negative integer, or absent (a fresh capture).
// Anything else (null, "abc", -5, 1.5) is corruption, and a safety counter must
// fail closed: with no trustworthy count there is no reply, and the capture
// parks where the user can see it.
function replyBudgetLeft(capture) {
  const attempts = capture.reply_attempts;
  if (attempts === undefined) return true;
  return Number.isInteger(attempts) && attempts >= 0 && attempts < MAX_REPLY_ATTEMPTS;
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
//
// And a WRAPPER that failed to unwrap is never a hub. l.instagram.com is an
// instagram.com host, so isHubPage is true for it, but there is nothing behind a
// failed wrapper for the user to go and find. Wrapper hosts are therefore ruled
// out BEFORE the hub test, which is why this checks isWrapperUrl first.
function parkReasonForLinks(urls) {
  if (pickBestUrl(urls) !== null) return UNUSABLE_LINK;
  const realHub = urls.some((url) => !isWrapperUrl(url) && isHubPage(url));
  return realHub ? HUB_PAGE : UNUSABLE_LINK;
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
  const word = findReplyWord(text);
  if (word !== null && replyBudgetLeft(capture)) {
    return { kind: 'reply', text: word };
  }
  if (typeof text === 'string' && FOLLOW_PROMPT.test(text)) {
    return { kind: 'park', reason: FOLLOW_GATE };
  }
  return { kind: 'park', reason: FREEFORM_GATE };
}

module.exports = { decide, matchItem, normalizeHandle, REPLY_WORDS, MAX_REPLY_ATTEMPTS };
