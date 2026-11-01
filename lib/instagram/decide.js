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

// When may the system speak? A reply sent from the user's own account to a real
// person cannot be taken back, while a gate we fail to answer parks in the tray
// where the user fixes it in seconds. So the rule is strict, and a missed gate
// is the accepted price. Loosen it only against a captured real gate wording,
// never against a guess about what bots might say.
//
// The rule: an allowlisted keyword (or a 1-2 digit menu number) is answered only
// when it completes an INSTRUCTION, meaning all of:
//   1. an instruction verb (reply, send, type, comment, dm) sits within the 2
//      words before it, e.g. "reply DONE", "reply with DONE", "DM me GO";
//   2. nothing in between ends the clause: no , . ! ? ; + & and no "and",
//      "then" or "or". A sentence boundary is a barrier the window will not
//      cross, so "...the late reply! yes" and "...the comment. Done" are two
//      sentences, not one instruction. (":", quotes, dashes and emoji are
//      crossable: "Reply: DONE", "reply 👉 DONE".) A line break does NOT stop
//      the keyword following the verb ("reply\nDONE"), but it does start a new
//      clause for rule 3;
//   3. the verb is IMPERATIVE, meaning it opens its clause (message start, or
//      right after a barrier or line break) with at most "just", "please",
//      "pls", "now" before it. This is what separates the verb "reply DONE"
//      from the noun in "sorry for the late reply", "thanks for the comment",
//      "your DM", "the reply DONE button", "I'll comment done": there the word
//      follows a determiner, a preposition or a pronoun;
//   4. no determiner or pronoun sits between verb and keyword: "send the link"
//      and "send it" describe sending something. (Needed even with rule 3,
//      because "Send the link to me" really is clause-initial and "link" is an
//      allowlist word.)
// Case is not evidence ("LET'S GO" is chatter) and does not matter ("reply
// done" works). Whole tokens only ("ongoing", "linked", "gone", "v2" contain no
// keyword). The reply is the keyword in canonical uppercase. A digit is only
// considered when no keyword qualified, so "In 2026, reply DONE" answers DONE.
// Quick-reply buttons arrive as payloads on a separate path and are untouched.
//
// Deliberately NOT answered, to be calibrated on real captured wording: "Say
// DONE", "Write DONE", "Drop a YES below", "Tap DONE". Do not add verbs on a
// hunch: "say yes to the dress" is a human.
const INSTRUCTION_VERBS = new Set(['reply', 'send', 'type', 'comment', 'dm']);
const VERB_WINDOW = 2;
const FILLERS = new Set(['just', 'please', 'pls', 'now']);
const BARRIER_WORDS = new Set(['and', 'then', 'or']);
const NOT_AN_INSTRUCTION_GAP = new Set([
  'the', 'a', 'an', 'your', 'my', 'our', 'this', 'that', 'these', 'those', 'it', 'its', 'you',
]);
// A bare number is a menu choice ("reply 1"), never a code or a year.
const MENU_CHOICE = /^\d{1,2}$/;

// Words of the message, each flagged with whether a barrier (`hard`) or a line
// break (`line`) came right before it. Punctuation and emoji that carry no
// meaning are dropped, but the barriers among them are remembered on the next
// word, so the window cannot walk across a clause boundary the strip erased.
function clauseTokens(text) {
  const tokens = [];
  let hard = false;
  let line = false;
  // 10,000 and 3.14 are numbers, not clause ends; keep them whole (and not 1-2 digits).
  const prepared = text.replace(/✅/g, ' ✅ ').replace(/(\d)[.,](?=\d)/g, '$1_');
  for (const piece of prepared.match(/\n|[,.!?;+&]|[^\s,.!?;+&]+/g) || []) {
    if (piece === '\n') { line = true; continue; }
    if (/^[,.!?;+&]$/.test(piece)) { hard = true; continue; }
    const word = piece.replace(/^[^\p{L}\p{N}✅]+|[^\p{L}\p{N}✅]+$/gu, '');
    if (!word) continue;
    if (BARRIER_WORDS.has(word.toLowerCase())) { hard = true; continue; }
    tokens.push({ word, hard, line });
    hard = false;
    line = false;
  }
  return tokens;
}

function findReplyWord(text) {
  if (typeof text !== 'string') return null;
  const tokens = clauseTokens(text);

  // Rule 3: the verb at j opens its clause, with only fillers ahead of it.
  const opensClause = (j) => {
    for (let k = j; ; k--) {
      if (k === 0 || tokens[k].hard || tokens[k].line) return true;
      if (!FILLERS.has(tokens[k - 1].word.toLowerCase())) return false;
    }
  };
  // Rules 1, 2 and 4, for the token at i.
  const completesInstruction = (i) => {
    for (let j = i - 1; j >= Math.max(0, i - VERB_WINDOW); j--) {
      if (tokens[j + 1].hard) return false;
      const word = tokens[j].word.toLowerCase();
      if (INSTRUCTION_VERBS.has(word) && opensClause(j)) return true;
      if (NOT_AN_INSTRUCTION_GAP.has(word)) return false;
    }
    return false;
  };

  for (let i = 0; i < tokens.length; i++) {
    const upper = tokens[i].word.toUpperCase();
    if (REPLY_WORDS.includes(upper) && completesInstruction(i)) return upper;
  }
  for (let i = 0; i < tokens.length; i++) {
    if (MENU_CHOICE.test(tokens[i].word) && completesInstruction(i)) return tokens[i].word;
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
