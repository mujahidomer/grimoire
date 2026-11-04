// Keyword gates: "Comment DESIGN to get the link".
//
// The caption is already stored on the item (Apify fetches it at save time),
// so working out which saved reels still need a comment, and what word to
// leave, is a pure function over text — no browser, no API.
//
// What this returns gets POSTED PUBLICLY from the user's account, so it is
// built for precision over recall. A gate we miss costs one manual comment; a
// word we invent appears under their name on a stranger's post forever. When
// the caption is ambiguous, return null and let a person decide.

// The instruction. A word boundary on both sides keeps the noun out: "the
// comments are full of ideas" is not an instruction, and neither is
// "Comments "DESIGN"".
const VERB = '(?:comment|dm|drop|type|send|write)';
// The shouted pattern cannot carry the `i` flag — requiring capitals IS what
// distinguishes a keyword from the next word of the sentence — so the verb
// spells its own capitalisation out instead.
const VERB_EITHER_CASE = '(?:[Cc]omment|[Dd][Mm]|[Dd]rop|[Tt]ype|[Ss]end|[Ww]rite)';

// Straight, curly and single quotes, since creators use all of them.
const QUOTE = '["“”‘’\']';
const QUOTED = `${QUOTE}\\s*([^"“”\n]{1,40}?)\\s*${QUOTE}`;

// Unquoted, it has to be SHOUTED to be recognisable as a token rather than
// the next word of the sentence. "Comment ANIMATE and I'll send you" is a
// keyword; "comment below and tell me" is not.
const SHOUTED = '([A-Z][A-Z0-9]{1,19})\\b';

// Something has to be on its way back, or there is no link to capture. This is
// the clause that separates a gate from "Type Ameen if you'll say it after
// Fajr", which asks for a comment and sends nothing.
const DELIVERY = new RegExp([
  'for the', 'to get', 'to receive', 'to grab', 'to download', 'to unlock',
  "i['’]?ll send", "i['’]?ll dm", 'i will send', 'and i.{0,4}ll send',
  'for instant', 'sent to you', 'and i.{0,4}ll share',
].join('|'), 'i');

// How far past the keyword the delivery clause may sit. Long enough for
// "Comment X to get this Free AI Tool to make premium websites", short enough
// that an unrelated sentence later in a long caption cannot vouch for a
// keyword at the top.
const DELIVERY_WINDOW = 200;

const MAX_KEYWORD_LENGTH = 24;
const MAX_KEYWORD_WORDS = 2;

const quotedGate = new RegExp(`\\b${VERB}\\b\\s+${QUOTED}`, 'i');
const shoutedGate = new RegExp(`\\b${VERB_EITHER_CASE}\\b\\s+${SHOUTED}`);

// Trailing punctuation a creator typed after the word, inside or outside the
// quotes. Emoji are kept: "Comment 🙌🏻 for the link" is a real gate and the
// emoji IS the keyword.
function tidy(raw) {
  return String(raw)
    .replace(/[\s.,!?;:•\-–—]+$/u, '')
    .replace(/^[\s.,!?;:•\-–—]+/u, '')
    .trim();
}

function plausibleKeyword(word) {
  if (!word) return false;
  if (word.length > MAX_KEYWORD_LENGTH) return false;
  if (word.split(/\s+/).length > MAX_KEYWORD_WORDS) return false;
  // Must carry at least one letter, digit or emoji — not just punctuation.
  return /[\p{L}\p{N}\p{Extended_Pictographic}]/u.test(word);
}

// The keyword a caption asks you to comment, or null when it asks for nothing
// that gets sent back.
function extractKeyword(caption) {
  if (typeof caption !== 'string' || !caption.trim()) return null;

  for (const pattern of [quotedGate, shoutedGate]) {
    const match = pattern.exec(caption);
    if (!match) continue;
    const word = tidy(match[1]);
    if (!plausibleKeyword(word)) continue;
    const tail = caption.slice(match.index, match.index + DELIVERY_WINDOW);
    if (!DELIVERY.test(tail)) continue;
    return word;
  }
  return null;
}

// ─── Confirmation ─────────────────────────────────────────────────────────────

// The pattern above is deliberately mechanical, and over a real library it
// still mistakes the odd sentence for a gate ("SHOWS", "MUM", "DIE" all came
// out of 510 captions). Posting one of those publicly under the user's name is
// the failure this guards against, so a candidate is read once more by a model
// that can see the whole caption and say "that is not a keyword".
//
// The model may only CONFIRM or REJECT the candidate the pattern found, never
// invent its own: a hallucinated keyword is exactly the thing being prevented,
// and anything the pattern cannot find is not urgent enough to risk it.
const CONFIRM_MODEL = 'claude-haiku-5-5';

const CONFIRM_PROMPT = `You are checking one Instagram caption before an automated comment is posted.

A "keyword gate" is a caption that asks the reader to comment a specific word, in return for something the creator then sends (a link, a guide, a tool, a file).

A caption that asks for a comment but sends nothing back is NOT a gate — for example "Type Ameen if you agree" or "Drop a fire emoji if this helped".

You are given the caption and the exact candidate word a pattern matched.
Answer with JSON only: {"gate": true} if the candidate is genuinely the word the creator asks readers to comment, or {"gate": false} otherwise.
Do not suggest a different word. Do not explain.`;

// true when the candidate really is the word to post. Any failure — a dead
// key, a timeout, unparseable output — returns false: not posting is always
// the safe direction, and the gate stays queued for a person to look at.
async function confirmKeyword(caption, candidate, { client, model = CONFIRM_MODEL } = {}) {
  if (!candidate || typeof caption !== 'string') return false;
  const anthropic = client || require('../anthropicClient').getAnthropicClient();
  try {
    const response = await anthropic.messages.create({
      model,
      max_tokens: 16,
      system: CONFIRM_PROMPT,
      messages: [{ role: 'user', content: `Caption:\n${caption.slice(0, 1500)}\n\nCandidate: ${candidate}` }],
    });
    const text = (response && response.content || [])
      .map((block) => (block && block.type === 'text' ? block.text : '')).join('');
    const match = /\{[^}]*\}/.exec(text);
    if (!match) return false;
    return JSON.parse(match[0]).gate === true;
  } catch {
    return false;
  }
}

module.exports = { extractKeyword, confirmKeyword, CONFIRM_MODEL };
