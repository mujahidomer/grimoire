const { test } = require('node:test');
const assert = require('node:assert');
const { extractKeyword } = require('../lib/instagram/gates');

// Every caption below is real, taken from the user's own saved reels on
// 2026-11-04. The keyword this returns gets POSTED PUBLICLY from their
// account, so the bar is precision: a missed gate costs one manual comment,
// a wrong one is a stranger's post with a nonsense word on it under their name.

test('reads a straight-quoted keyword', () => {
  assert.strictEqual(
    extractKeyword('Comment "DESIGN" to get this Free AI Tool to make premium websites with Claude Code.'),
    'DESIGN');
});

test('reads a curly-quoted keyword', () => {
  assert.strictEqual(extractKeyword('Comment “Claude” for the link'), 'Claude');
  assert.strictEqual(extractKeyword('Comment “Leads” for the link'), 'Leads');
});

test('trims padding the creator left inside the quotes', () => {
  assert.strictEqual(extractKeyword('Comment “FM “ for the link'), 'FM');
});

test('reads an unquoted shouted keyword', () => {
  assert.strictEqual(
    extractKeyword("Comment ANIMATE and I'll send you every prompt"),
    'ANIMATE');
});

test('keeps a lowercase keyword the creator chose', () => {
  assert.strictEqual(
    extractKeyword('Your children are bored without Islamic side quests👌 Comment “raise” for the full parenting guides❤️'),
    'raise');
  assert.strictEqual(
    extractKeyword("Claude just replaced my graphic designer😳 Comment \"guide\" and I'll send you my free guide"),
    'guide');
});

test('keeps an emoji keyword', () => {
  assert.strictEqual(extractKeyword('Comment “🙌🏻” for the link'), '🙌🏻');
});

// The delivery clause is what separates a gate from a caption that merely
// says "comment". Without it there is nothing being sent, so there is nothing
// to capture and no reason to post anything.
test('ignores an engagement prompt that sends nothing', () => {
  assert.strictEqual(
    extractKeyword("Type \"Ameen\" if you'll say it after Fajr tomorrow 🤲 Umm Salamah narrated that"),
    null);
  assert.strictEqual(extractKeyword('Drop a “🔥” if this helped you today'), null);
});

test('ignores a caption that just uses the word comment', () => {
  assert.strictEqual(extractKeyword('Save this for later. The comments are full of great ideas.'), null);
  assert.strictEqual(extractKeyword('I read every comment on this account'), null);
});

test('ignores a caption with no gate at all', () => {
  assert.strictEqual(extractKeyword('Cute, low stimulating and calm animated storybooks made for tiny hearts.'), null);
  assert.strictEqual(extractKeyword(''), null);
  assert.strictEqual(extractKeyword(null), null);
  assert.strictEqual(extractKeyword(undefined), null);
});

// A keyword is a short token. Anything long is the extractor having grabbed a
// sentence, and posting a sentence would be obvious nonsense.
test('refuses something too long to be a keyword', () => {
  assert.strictEqual(
    extractKeyword('Comment "the full guide to everything I have ever built" to get it'), null);
});

test('refuses a keyword that is only punctuation or empty', () => {
  assert.strictEqual(extractKeyword('Comment "" for the link'), null);
  assert.strictEqual(extractKeyword('Comment "..." for the link'), null);
});

// "comments" is a noun, not an instruction.
test('does not fire on a plural or possessive form of the verb', () => {
  assert.strictEqual(extractKeyword('Comments "DESIGN" for the link'), null);
});

test('allows a two-word keyword but not a phrase', () => {
  assert.strictEqual(extractKeyword('Comment "AI AGENT" to get the template'), 'AI AGENT');
  assert.strictEqual(extractKeyword('Comment "send me the whole thing now" to get it'), null);
});

// ─── confirmKeyword ───────────────────────────────────────────────────────────

const { confirmKeyword } = require('../lib/instagram/gates');
const fakeClient = (text) => ({ messages: { create: async () => ({ content: [{ type: 'text', text }] }) } });
const throwingClient = { messages: { create: async () => { throw new Error('key revoked'); } } };

test('confirmKeyword accepts a confirmed gate', async () => {
  assert.strictEqual(
    await confirmKeyword('Comment "DESIGN" to get the tool', 'DESIGN', { client: fakeClient('{"gate": true}') }),
    true);
});

test('confirmKeyword rejects what the model calls not a gate', async () => {
  assert.strictEqual(
    await confirmKeyword('I read every comment', 'SHOWS', { client: fakeClient('{"gate": false}') }),
    false);
});

// Not posting is always the safe direction, so every failure says no.
test('confirmKeyword says no when the model cannot be reached or understood', async () => {
  assert.strictEqual(await confirmKeyword('c', 'X', { client: throwingClient }), false);
  assert.strictEqual(await confirmKeyword('c', 'X', { client: fakeClient('no idea') }), false);
  assert.strictEqual(await confirmKeyword('c', 'X', { client: fakeClient('{"gate": "yes"}') }), false);
  assert.strictEqual(await confirmKeyword('c', '', { client: fakeClient('{"gate": true}') }), false);
  assert.strictEqual(await confirmKeyword(null, 'X', { client: fakeClient('{"gate": true}') }), false);
});

test('confirmKeyword tolerates prose around the json', async () => {
  assert.strictEqual(
    await confirmKeyword('Comment "GUIDE" to get it', 'GUIDE',
      { client: fakeClient('Here you go: {"gate": true} — hope that helps') }),
    true);
});
