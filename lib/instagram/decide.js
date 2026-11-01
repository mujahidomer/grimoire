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
// The shape of the rule was derived from real gates ("Reply DONE", "Comment DONE
// below", "DM me GO", "Type DONE to receive the free guide", "reply with DONE",
// "To unlock, send DONE"), not from a list of things to rule out. In every one,
// a verb opens a clause and the keyword is THE THING TO TYPE, so it closes the
// instruction. An allowlisted keyword is answered only when ALL of these hold:
//
//   1. VERB. An instruction verb (reply, send, type, comment, dm) opens the
//      clause: it is the first word of the message, or right after a sentence
//      boundary (, . ! ? ; + & or a line break), with at most "just", "please",
//      "pls", "now" ahead of it. A noun phrase at the start of a sentence is not
//      safe by itself (see 3); but "late reply", "the comment", "your DM",
//      "I'll comment" are not clause-initial, so they never count as a verb.
//   2. ADJACENT. The keyword is the next word after the verb, or after the verb
//      plus exactly one of "me" / "with" ("DM me GO", "Reply with DONE"). That
//      is an ALLOWLIST: any other word between them ("Send us LINK", "Send the
//      link", "DM sent ✅", "Comment posted ✅") means this is not an
//      instruction to type the keyword.
//   3. CLOSING. The keyword ends its instruction: it is the last word of its
//      clause, or is followed only by "below", "to" or "for" ("Comment DONE
//      below", "Type DONE to receive...", "DM DONE for access"). Otherwise the
//      keyword is modifying what follows ("Send LINK tomorrow"). Rules 1 and 2
//      only look at what comes BEFORE the keyword and cannot tell "Type DONE"
//      from "Type 2 diabetes"; this rule looks after it.
//   4. NO BOUNDARY BETWEEN verb and keyword, so "...the late reply! yes" is two
//      sentences. (":", quotes, dashes and emoji are crossable: "Reply: DONE",
//      "reply 👉 DONE".) A line break does not stop a keyword that follows a
//      line-ending verb ("reply\nDONE") but does start a new clause.
//
// "and" and "then" END a clause (so "Reply DONE and I will send it" closes
// DONE) but never OPEN one: "I'll take a look and send link" is one sentence,
// not an instruction. The price is that "Follow me and reply DONE" parks. "or"
// is deliberately NOT a boundary: "Reply YES or NO" offers a choice, so the
// keyword is not the single thing to type and nothing is sent.
//
// Case is not evidence ("LET'S GO" is chatter) and does not matter ("reply
// done" works). Whole tokens only. The reply is the keyword in canonical
// uppercase. There is NO bare-digit reply: a 1-2 digit number after a verb-like
// word is an ordinary quantifier ("Type 2 diabetes"), and no captured gate has
// yet shown a numbered menu. Quick-reply buttons arrive as payloads on a
// separate path and are untouched by this matching.
//
// Deliberately NOT answered, to be calibrated on real captured wording: "Say
// DONE", "Write DONE", "Drop a YES below", "Tap DONE", "Reply 1", "Follow me and
// reply DONE". Do not add verbs or digits on a hunch: "say yes to the dress" is
// a human.
const INSTRUCTION_VERBS = new Set(['reply', 'send', 'type', 'comment', 'dm']);
const FILLERS = new Set(['just', 'please', 'pls', 'now']);
// The only words allowed between verb and keyword.
const ALLOWED_GAP = new Set(['me', 'with']);
// The only words allowed to follow a keyword that still closes its instruction.
const CLOSERS = new Set(['below', 'to', 'for']);
// End a clause but never open one.
const CONJUNCTIONS = new Set(['and', 'then']);

// Words of the message with the clause structure the matcher needs. `hard`: a
// boundary (punctuation, conjunction) came right before this word, ending the
// previous clause. `opens`: a clause may begin here (after punctuation or a
// line break, but NOT after a bare conjunction). Characters that carry no
// meaning (quotes, emoji, dashes) are dropped, but the boundaries among them are
// remembered on the next word, so nothing can walk across a clause boundary the
// strip erased.
function clauseTokens(text) {
  const tokens = [];
  let hard = false;
  let opens = false;
  const prepared = text.replace(/✅/g, ' ✅ ');
  for (const piece of prepared.match(/\n|[,.!?;+&]|[^\s,.!?;+&]+/g) || []) {
    if (piece === '\n') { opens = true; continue; }
    if (/^[,.!?;+&]$/.test(piece)) { hard = true; opens = true; continue; }
    const word = piece.replace(/^[^\p{L}\p{N}✅]+|[^\p{L}\p{N}✅]+$/gu, '');
    if (!word) continue;
    if (CONJUNCTIONS.has(word.toLowerCase())) { hard = true; continue; }
    tokens.push({ word, hard, opens });
    hard = false;
    opens = false;
  }
  return tokens;
}

function findReplyWord(text) {
  if (typeof text !== 'string') return null;
  const tokens = clauseTokens(text);
  const lower = (i) => tokens[i].word.toLowerCase();

  // Rule 1: the verb at j opens its clause, with only fillers ahead of it.
  const opensClause = (j) => {
    for (let k = j; ; k--) {
      if (k === 0 || tokens[k].opens) return true;
      if (!FILLERS.has(lower(k - 1))) return false;
    }
  };
  // Rule 3: nothing follows the keyword at i but a boundary or a closer.
  const closes = (i) => {
    const next = tokens[i + 1];
    return !next || next.hard || next.opens || CLOSERS.has(next.word.toLowerCase());
  };
  const completesInstruction = (i) => {
    if (tokens[i].hard) return false; // rule 4: a boundary right before the keyword
    let j = i - 1;
    if (j >= 0 && ALLOWED_GAP.has(lower(j))) { // rule 2: me / with, and nothing else
      if (tokens[j].hard) return false;        // rule 4
      j -= 1;
    }
    if (j < 0 || !INSTRUCTION_VERBS.has(lower(j)) || !opensClause(j)) return false;
    return closes(i);
  };

  for (let i = 0; i < tokens.length; i++) {
    const upper = tokens[i].word.toUpperCase();
    if (REPLY_WORDS.includes(upper) && completesInstruction(i)) return upper;
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
