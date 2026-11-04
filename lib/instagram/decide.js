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
//   1. resolvedUrl present
//        it is itself a hub / instagram.com / media file   -> park (see
//          parkReasonForResolved). A short link only reveals that it is a
//          Linktree or an Instagram page AFTER resolution, so the pre-resolution
//          candidates cannot catch it. Judged before the creator, like any link.
//        creator matches a candidate                       -> attach
//        no match                                          -> park no_match
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

const { extractUrls, pickBestUrl, isHubPage, isMediaUrl, isWrapperUrl } = require('./links');
const { normalizeUsername, NEEDS_USER_REASONS } = require('./captures');

// Task 4's normalizeUsername under the name this module's callers use. There is
// deliberately one implementation: two functions for one concept drift apart,
// and a handle compared with one rule on write and another on read matches
// nothing. Compare the result with ===, never ilike (underscores are LIKE
// wildcards, and are common in Instagram handles).
const normalizeHandle = normalizeUsername;

const [FOLLOW_GATE, FREEFORM_GATE, HUB_PAGE, UNUSABLE_LINK, NO_MATCH, REPLY_EXHAUSTED] = [
  'follow_gate', 'freeform_gate', 'hub_page', 'unusable_link', 'no_match', 'reply_exhausted',
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
//      clause, or is followed by "below", "to" or "for" and then a SHORT tail
//      (at most MAX_CLOSER_TAIL words, to the end of the clause): "Comment DONE
//      below", "Type DONE to receive the free guide", "DM DONE for access".
//      Otherwise the keyword is modifying what follows ("Send LINK tomorrow"),
//      or the closer introduces a whole new statement ("Reply YES to confirm
//      you want me to charge my card"): a long tail is a sentence about
//      something, not the name of a prize. A closer alone is not enough, because
//      the tail after it is where the consequence sits. Rules 1 and 2 only look
//      at what comes BEFORE the keyword and cannot tell "Type DONE" from "Type 2
//      diabetes"; this rule looks after it.
//   3b. NO ALTERNATIVE. No "or" anywhere after the keyword, in any clause. "Reply
//      YES or NO" and "Reply YES to delete, or NO to keep" offer a choice, so
//      the keyword is not THE thing to type. This is checked separately from
//      rule 3 because a closer ("to") and a comma used to hide the "or" from it.
//   4. NO BOUNDARY BETWEEN verb and keyword, so "...the late reply! yes" is two
//      sentences. (":", quotes, dashes and emoji are crossable: "Reply: DONE",
//      "reply 👉 DONE".) A line break does not stop a keyword that follows a
//      line-ending verb ("reply\nDONE") but does start a new clause.
//
// "and" and "then" END a clause (so "Reply DONE and I will send it" closes
// DONE) but never OPEN one: "I'll take a look and send link" is one sentence,
// not an instruction. The price is that "Follow me and reply DONE" parks. "or"
// is deliberately NOT a boundary (making it one would let "Reply YES or NO"
// close at YES and be answered): it is rule 3b, a veto on any "or" that follows
// the keyword.
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
// Verb + keyword pairs rejected as ordinary transitive English (see
// completesInstruction).
const NOUN_OBJECT = new Set(['send link', 'dm link', 'send send', 'send yes', 'send go']);
// The only words allowed between verb and keyword.
const ALLOWED_GAP = new Set(['me', 'with']);
// The only words allowed to follow a keyword that still closes its instruction.
const CLOSERS = new Set(['below', 'to', 'for']);
// The longest tail a closer may carry ("Type DONE to receive the free guide" is
// four). Longer ones are full sentences ("...to confirm you want to cancel your
// plan"), which a gate is not.
const MAX_CLOSER_TAIL = 4;
const ALTERNATIVE = 'or';
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
  // Rule 3b: an "or" anywhere after the keyword offers a choice.
  const offersAlternative = (i) => tokens.slice(i + 1).some((t) => t.word.toLowerCase() === ALTERNATIVE);
  // Rule 3: the keyword ends its clause, or only a closer and a short tail follow.
  const closes = (i) => {
    if (offersAlternative(i)) return false;
    const next = tokens[i + 1];
    if (!next || next.hard || next.opens) return true;
    if (!CLOSERS.has(next.word.toLowerCase())) return false;
    let tail = 0;
    for (let k = i + 2; k < tokens.length && !tokens[k].hard && !tokens[k].opens; k++) tail += 1;
    return tail <= MAX_CLOSER_TAIL;
  };
  const completesInstruction = (i) => {
    if (tokens[i].hard) return false; // rule 4: a boundary right before the keyword
    let j = i - 1;
    if (j >= 0 && ALLOWED_GAP.has(lower(j))) { // rule 2: me / with, and nothing else
      if (tokens[j].hard) return false;        // rule 4
      j -= 1;
    }
    if (j < 0 || !INSTRUCTION_VERBS.has(lower(j)) || !opensClause(j)) return false;
    // Pairs that are ordinary English, not an instruction to type a token. A gate
    // asks the USER to type a keyword; no creator asks the user to send THEM a
    // link, so these pairs can be rejected outright. "send link" / "send me
    // link" / "DM me link" is simply how a person asks for a link (the creator,
    // a human, writes it, and the user's own account must not answer "LINK").
    // This is the first set to loosen if a real captured gate ever uses "Send
    // LINK". It cannot be done for reply+link: "Reply 'LINK' and I'll send it
    // over" is a real gate, so "reply with link", "comment link" and "type link"
    // stay reachable. Less natural than "send link"; accepted.
    if (NOUN_OBJECT.has(`${lower(j)} ${tokens[i].word.toLowerCase()}`)) return false;
    // The check mark is paired only with "reply" ("reply ✅ to continue"), the one
    // verb it appears with in any captured gate. "Comment ✅", "Send ✅", "DM ✅"
    // are confirmations ("DM sent ✅" already parks).
    if (tokens[i].word === '✅' && lower(j) !== 'reply') return false;
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

// True only for a counter that is a valid integer AT OR ABOVE the cap: we tried
// the allowed number of times and gave up. A corrupt counter also fails closed
// (replyBudgetLeft is false) but is NOT this: nothing was tried.
function replyBudgetSpent(capture) {
  const attempts = capture.reply_attempts;
  return Number.isInteger(attempts) && attempts >= MAX_REPLY_ATTEMPTS;
}

// What the text of a message that carries only hub links says about itself:
// a follow prompt, or an allowlisted instruction to reply. Null when it shows
// no sign of being a gate. Used only to pick a more truthful park reason; a
// message with a link is never answered.
function gateReasonForText(text) {
  if (typeof text !== 'string') return null;
  if (FOLLOW_PROMPT.test(text)) return FOLLOW_GATE;
  if (findReplyWord(text) !== null) return FREEFORM_GATE;
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

// Why a RESOLVED url is not an article, or null when it is one. The same mapping
// as parkReasonForLinks, applied to where a link ended up rather than where it
// started: a wrapper or media file is unusable_link (checked first, since
// l.instagram.com is also an instagram.com host and there is no hub behind a
// wrapper), any other hub or instagram.com page is hub_page. One owner for
// reason selection: capture.js passes the resolved url through untouched.
function parkReasonForResolved(url) {
  if (isWrapperUrl(url) || isMediaUrl(url)) return UNUSABLE_LINK;
  if (isHubPage(url)) return HUB_PAGE;
  return null;
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
// `urls` lets the caller pass candidates it found somewhere other than the
// event — a button card's links live only in the Graph API's copy of the
// message, never in the webhook payload. Omitted, the event is the source.
function decide({ capture, event, resolvedUrl, candidates, urls: given } = {}) {
  const matched = matchItem(candidates, capture && capture.sender_username);

  if (resolvedUrl) {
    const notAnArticle = parkReasonForResolved(resolvedUrl);
    if (notAnArticle) return { kind: 'park', reason: notAnArticle };
    return matched
      ? { kind: 'attach', itemId: matched.id, url: resolvedUrl }
      : { kind: 'park', reason: NO_MATCH };
  }

  const urls = Array.isArray(given) ? given : extractUrls(event);
  if (urls.length > 0) {
    // A photo or video someone sent: every "link" is Instagram's own media CDN,
    // so there is no article here. From a creator whose reel we saved it may
    // still be the thing they promised, and that parks below. From anyone else
    // it is an ordinary DM, and the tray is for captures the user can act on.
    if (!matched && urls.every(isMediaUrl)) {
      return { kind: 'ignore', reason: 'unmatched_sender_media_only' };
    }
    const reason = parkReasonForLinks(urls);
    // "Follow me https://instagram.com/thecreator and reply DONE": the only link
    // is the creator's own profile, but the message is a gate, and telling the
    // user to "find the article" would be the wrong guidance. Still never
    // answered: a message with a link is not replied to.
    if (reason === HUB_PAGE) {
      const gate = gateReasonForText(event && event.message && event.message.text);
      if (gate) return { kind: 'park', reason: gate };
    }
    return { kind: 'park', reason };
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
  // A gate we answered the allowed number of times and which still stands:
  // different from a question we cannot parse, and different advice.
  if (word !== null && replyBudgetSpent(capture)) return { kind: 'park', reason: REPLY_EXHAUSTED };
  return { kind: 'park', reason: FREEFORM_GATE };
}

module.exports = { decide, matchItem, normalizeHandle, REPLY_WORDS, MAX_REPLY_ATTEMPTS };
