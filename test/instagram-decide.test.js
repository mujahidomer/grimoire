const { test } = require('node:test');
const assert = require('node:assert');
const { decide, matchItem, normalizeHandle } = require('../lib/instagram/decide');
const { normalizeUsername, NEEDS_USER_REASONS } = require('../lib/instagram/captures');

const reel = (author, created) => ({
  id: `item-${author}-${created}`, source_author: author,
  source_url: 'https://instagram.com/reel/ABC', created_at: created,
});
const base = { capture: { reply_attempts: 0, state: 'awaiting_link' }, candidates: [], resolvedUrl: null };
const fromC = (extra) => ({ ...base,
  candidates: [reel('c', '2026-11-01T10:00:00Z')],
  capture: { ...base.capture, sender_username: 'c' }, ...extra });

// Review Focus 4: case and @ differences between Apify and the DM sender
test('normalizeHandle strips @ and lowercases', () => {
  assert.strictEqual(normalizeHandle('@TheCreator'), 'thecreator');
  assert.strictEqual(normalizeHandle(' thecreator '), 'thecreator');
});

test('normalizeHandle is the one implementation in captures.js, not a copy', () => {
  assert.strictEqual(normalizeHandle, normalizeUsername);
});

test('matchItem matches across case and @ differences', () => {
  const found = matchItem([reel('TheCreator', '2026-11-01T10:00:00Z')], '@thecreator');
  assert.strictEqual(found.source_author, 'TheCreator');
});

test('matchItem takes the most recent of two reels by the same creator', () => {
  const items = [reel('c', '2026-11-01T09:00:00Z'), reel('c', '2026-11-01T11:00:00Z')];
  assert.strictEqual(matchItem(items, 'c').created_at, '2026-11-01T11:00:00Z');
});

test('matchItem returns null when no candidate matches', () => {
  assert.strictEqual(matchItem([reel('other', '2026-11-01T10:00:00Z')], 'c'), null);
});

test('matchItem compares exactly: an underscore is not a wildcard', () => {
  assert.strictEqual(matchItem([reel('axb', '2026-11-01T10:00:00Z')], 'a_b'), null);
  assert.ok(matchItem([reel('a_b', '2026-11-01T10:00:00Z')], 'A_B'));
});

test('matchItem copes with a missing sender and items with no author', () => {
  const items = [reel(null, '2026-11-01T10:00:00Z'), reel('c', '2026-11-01T09:00:00Z')];
  assert.strictEqual(matchItem(items, null), null);
  assert.strictEqual(matchItem(items, '@'), null);
  assert.strictEqual(matchItem(items, 'c').source_author, 'c');
});

test('decide attaches a resolved url to the matched reel', () => {
  const action = decide({ ...base,
    event: { message: { text: 'https://example.com/guide' } },
    resolvedUrl: 'https://example.com/guide',
    candidates: [reel('c', '2026-11-01T10:00:00Z')],
    capture: { ...base.capture, sender_username: 'c' } });
  assert.strictEqual(action.kind, 'attach');
  assert.strictEqual(action.url, 'https://example.com/guide');
});

test('decide attaches to the matched item id, matching across case and @', () => {
  const action = decide(fromC({
    event: { message: { text: 'https://example.com/guide' } },
    resolvedUrl: 'https://example.com/guide?utm=1',
    capture: { ...base.capture, sender_username: '@C' } }));
  assert.deepStrictEqual(action,
    { kind: 'attach', itemId: 'item-c-2026-11-01T10:00:00Z', url: 'https://example.com/guide?utm=1' });
});

test('decide parks with no_match when the creator has no saved reel', () => {
  const action = decide({ ...base,
    event: { message: { text: 'https://example.com/guide' } },
    resolvedUrl: 'https://example.com/guide',
    capture: { ...base.capture, sender_username: 'unsaved' } });
  assert.deepStrictEqual(action, { kind: 'park', reason: 'no_match' });
});

test('decide replies DONE to an allowlisted gate from a matched creator', () => {
  const action = decide({ ...base,
    event: { message: { text: 'Almost! Just reply DONE and I will send it' } },
    candidates: [reel('c', '2026-11-01T10:00:00Z')],
    capture: { ...base.capture, sender_username: 'c' } });
  assert.deepStrictEqual(action, { kind: 'reply', text: 'DONE' });
});

test('decide parks a follow gate rather than replying', () => {
  const action = decide({ ...base,
    event: { message: { text: 'Make sure you follow me first!' } },
    candidates: [reel('c', '2026-11-01T10:00:00Z')],
    capture: { ...base.capture, sender_username: 'c' } });
  assert.deepStrictEqual(action, { kind: 'park', reason: 'follow_gate' });
});

test('decide parks after two reply attempts', () => {
  const action = decide({ ...base,
    event: { message: { text: 'reply DONE' } },
    candidates: [reel('c', '2026-11-01T10:00:00Z')],
    capture: { ...base.capture, sender_username: 'c', reply_attempts: 2 } });
  assert.strictEqual(action.kind, 'park');
});

test('decide never replies to a sender with no matching saved reel', () => {
  const action = decide({ ...base,
    event: { message: { text: 'reply DONE' } },
    capture: { ...base.capture, sender_username: 'a-stranger' } });
  assert.notStrictEqual(action.kind, 'reply');
});

test('decide parks hub_page when the link resolves to a hub', () => {
  const action = decide({ ...base,
    event: { message: { text: 'https://linktr.ee/c' } },
    resolvedUrl: null,
    candidates: [reel('c', '2026-11-01T10:00:00Z')],
    capture: { ...base.capture, sender_username: 'c' } });
  assert.deepStrictEqual(action, { kind: 'park', reason: 'hub_page' });
});

// --- Additions beyond the brief's eleven -----------------------------------

test('decide parks hub_page for an instagram.com link', () => {
  const action = decide(fromC({ event: { message: { text: 'see https://www.instagram.com/c/' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'hub_page' });
});

test('decide parks unusable_link, not hub_page, for an image-only share', () => {
  const action = decide(fromC({ event: { message: { attachments: [
    { type: 'image', payload: { url: 'https://scontent.cdninstagram.com/v/t51/x.jpg' } }] } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'unusable_link' });
});

test('decide parks unusable_link for an fbcdn media link in text', () => {
  const action = decide(fromC({ event: { message: { text: 'https://video.fbcdn.net/v/clip.mp4' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'unusable_link' });
});

test('decide parks unusable_link for a facebook wrapper that failed to unwrap', () => {
  const action = decide(fromC({ event: { message: { text: 'https://l.facebook.com/l.php?e=abc' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'unusable_link' });
});

test('decide parks unusable_link, not hub_page, for an instagram wrapper that failed to unwrap', () => {
  // l.instagram.com is an instagram.com host (isHubPage is true) but it is a
  // wrapper: there is no hub behind it for the user to go and find.
  const action = decide(fromC({ event: { message: { text: 'https://l.instagram.com/?e=abc' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'unusable_link' });
  for (const host of ['l.facebook.com', 'lm.facebook.com']) {
    const a = decide(fromC({ event: { message: { text: `https://${host}/l.php?e=abc` } } }));
    assert.deepStrictEqual(a, { kind: 'park', reason: 'unusable_link' }, host);
  }
});

test('decide still parks hub_page when a real hub sits beside a failed wrapper', () => {
  const action = decide(fromC({ event: { message: {
    text: 'https://l.instagram.com/?e=abc https://linktr.ee/c' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'hub_page' });
});

test('decide parks unusable_link when the picked article url failed to resolve', () => {
  // A usable article was found and the fetch failed; the hub in the same
  // message is not the reason the capture is stuck.
  const action = decide(fromC({ event: { message: {
    text: 'https://example.com/guide and https://linktr.ee/c' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'unusable_link' });
});

test('decide parks hub_page when the only candidates are hubs, even mixed with media', () => {
  const action = decide(fromC({ event: { message: {
    text: 'https://scontent.cdninstagram.com/x.jpg https://linktr.ee/c' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'hub_page' });
});

test('decide judges the link before the creator: a hub from an unsaved creator is hub_page', () => {
  // Only a usable resolved url needs a matched reel; a hub is a hub regardless.
  const action = decide({ ...base,
    event: { message: { text: 'https://linktr.ee/c' } },
    capture: { ...base.capture, sender_username: 'unsaved' } });
  assert.deepStrictEqual(action, { kind: 'park', reason: 'hub_page' });
});

test('decide ignores a link-less DM from a sender with no saved reel', () => {
  const action = decide({ ...base,
    event: { message: { text: 'hey, how are you?' } },
    capture: { ...base.capture, sender_username: 'a-stranger' } });
  assert.strictEqual(action.kind, 'ignore');
  assert.strictEqual(typeof action.reason, 'string');
});

test('decide ignores a link-less DM when the capture has no sender_username', () => {
  const action = decide({ ...base, event: { message: { text: 'reply DONE' } },
    candidates: [reel('c', '2026-11-01T10:00:00Z')] });
  assert.strictEqual(action.kind, 'ignore');
});

test('decide replies with each allowlisted word', () => {
  for (const word of ['DONE', 'YES', 'SEND', 'LINK', 'GO', '✅']) {
    const action = decide(fromC({ event: { message: { text: `Reply ${word} to get it` } } }));
    assert.deepStrictEqual(action, { kind: 'reply', text: word }, word);
  }
});

test('decide matches allowlist words whole-word and replies in canonical uppercase', () => {
  assert.deepStrictEqual(
    decide(fromC({ event: { message: { text: 'just reply done!' } } })),
    { kind: 'reply', text: 'DONE' });
  // "ongoing", "linked", "gone" contain allowlist words but are not them.
  assert.deepStrictEqual(
    decide(fromC({ event: { message: { text: 'ongoing and linked, then gone' } } })),
    { kind: 'park', reason: 'freeform_gate' });
});

test('decide replies with the first qualifying allowlist word in the prompt', () => {
  const action = decide(fromC({ event: { message: { text: 'Reply YES and then DONE' } } }));
  assert.deepStrictEqual(action, { kind: 'reply', text: 'YES' });
});

test('decide still replies on the second attempt and stops on the third', () => {
  const ev = { message: { text: 'reply DONE' } };
  const at = (n) => decide(fromC({ event: ev, capture: { sender_username: 'c', reply_attempts: n } }));
  assert.strictEqual(at(0).kind, 'reply');
  assert.strictEqual(at(1).kind, 'reply');
  assert.deepStrictEqual(at(2), { kind: 'park', reason: 'freeform_gate' });
  assert.strictEqual(at(3).kind, 'park');
});

test('decide treats a missing reply_attempts as zero', () => {
  const action = decide(fromC({ event: { message: { text: 'reply DONE' } },
    capture: { sender_username: 'c' } }));
  assert.strictEqual(action.kind, 'reply');
});

test('decide parks follow_gate even once the reply budget is spent', () => {
  const action = decide(fromC({ event: { message: { text: 'follow me and reply DONE' } },
    capture: { sender_username: 'c', reply_attempts: 2 } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'follow_gate' });
});

test('decide replies to a prompt that mentions following but also names a keyword', () => {
  // Follow gates are mostly unenforced prose (spec risk 3), so the keyword is tried first.
  const action = decide(fromC({ event: { message: { text: 'Follow me, then reply DONE' } } }));
  assert.deepStrictEqual(action, { kind: 'reply', text: 'DONE' });
});

test('decide parks freeform_gate for a prompt with no allowlist word and no follow', () => {
  const action = decide(fromC({ event: { message: { text: 'What is your biggest challenge right now?' } } }));
  assert.deepStrictEqual(action, { kind: 'park', reason: 'freeform_gate' });
});

test('decide parks freeform_gate for an event with no message', () => {
  assert.deepStrictEqual(decide(fromC({ event: {} })), { kind: 'park', reason: 'freeform_gate' });
});

test('decide never returns a park reason outside NEEDS_USER_REASONS', () => {
  const events = [
    'https://linktr.ee/c', 'https://scontent.cdninstagram.com/x.jpg', 'https://example.com/a',
    'follow me', 'reply DONE', 'hello',
  ];
  for (const sender of ['c', 'nobody']) {
    for (const attempts of [0, 2]) {
      for (const text of events) {
        for (const resolvedUrl of [null, 'https://example.com/a']) {
          const action = decide({ ...base, resolvedUrl, event: { message: { text } },
            candidates: [reel('c', '2026-11-01T10:00:00Z')],
            capture: { sender_username: sender, reply_attempts: attempts } });
          if (action.kind === 'park') assert.ok(NEEDS_USER_REASONS.includes(action.reason), action.reason);
        }
      }
    }
  }
});

test('decide does not mutate its input and returns a plain object, not a promise', () => {
  const input = fromC({ event: { message: { text: 'reply DONE' } } });
  const snapshot = JSON.stringify(input);
  const result = decide(input);
  assert.strictEqual(JSON.stringify(input), snapshot);
  assert.strictEqual(typeof result.then, 'undefined'); // a plain object, not a promise
});

test('decide: a resolvedUrl takes precedence over gate text in the same message', () => {
  const action = decide(fromC({
    event: { message: { text: 'reply DONE https://example.com/a' } },
    resolvedUrl: 'https://example.com/a' }));
  assert.strictEqual(action.kind, 'attach');
});

// --- Review fixes: the reply word needs evidence of a gate prompt ----------

const replyTo = (text, extra) => decide(fromC({ event: { message: { text } }, ...extra }));

test('decide never replies with a digit: no number is ever sent back', () => {
  // The bare-digit pass was removed: no captured gate has shown a numbered menu,
  // and a 1-2 digit number after a noun-sense verb is an ordinary quantifier
  // ("Type 2 diabetes"). Restore it only against a captured real gate.
  for (const text of ['your code is 4111111111111111, reply with it', 'reply 123', 'Reply 2026 to enter',
    'Reply 12 for the guide', 'Reply 1 for the guide', 'type 2 to continue', 'Type 1', "I'm 25"]) {
    assert.notStrictEqual(replyTo(text).kind, 'reply', text);
  }
});

test('decide does not answer a bare uppercase keyword: case is not evidence of a gate', () => {
  // Previously an uppercase token replied on its own. That path is removed on
  // purpose: "LET'S GO" from a human is the same failure as "let's go".
  for (const text of ["LET'S GO", 'DONE', 'Tap DONE when you are ready', 'Almost there... YES',
    'WE SEND THE LINK TOMORROW', 'YES!!!', 'GO GO GO']) {
    assert.deepStrictEqual(replyTo(text), { kind: 'park', reason: 'freeform_gate' }, text);
  }
});

test('decide answers an uppercase keyword when an instruction verb precedes it', () => {
  for (const text of ['Reply DONE', 'Comment DONE', 'Type YES', 'DM me GO', 'Just reply LINK to get it']) {
    assert.strictEqual(replyTo(text).kind, 'reply', text);
  }
  assert.deepStrictEqual(replyTo('Comment DONE'), { kind: 'reply', text: 'DONE' });
});

test('decide needs the instruction verb within two words, whatever the case', () => {
  assert.strictEqual(replyTo('reply to this with DONE').kind, 'park');
  assert.strictEqual(replyTo('Reply with DONE').kind, 'reply');
});

test('decide answers a lowercase keyword right after an instruction verb', () => {
  assert.deepStrictEqual(replyTo('just reply done!'), { kind: 'reply', text: 'DONE' });
  assert.deepStrictEqual(replyTo('type yes to get it'), { kind: 'reply', text: 'YES' });
  assert.deepStrictEqual(replyTo('comment link below'), { kind: 'reply', text: 'LINK' });
  assert.deepStrictEqual(replyTo('DM me go and I will send it'), { kind: 'reply', text: 'GO' });
  assert.deepStrictEqual(replyTo('Reply Done'), { kind: 'reply', text: 'DONE' });
});

test('decide does not answer ordinary English that happens to contain a keyword', () => {
  for (const text of [
    "sure, I'll send it", "let's go", "yes, I'm 25", 'yes', 'go for it',
    "I'll send you the link tomorrow", "I'll send the link tomorrow", 'send it go', 'the link is in my bio',
    'Done and dusted',
  ]) {
    assert.deepStrictEqual(replyTo(text), { kind: 'park', reason: 'freeform_gate' }, text);
  }
});

test('decide answers the keyword even when digits are in the message', () => {
  assert.deepStrictEqual(replyTo('In 2026, reply DONE'), { kind: 'reply', text: 'DONE' });
  assert.deepStrictEqual(replyTo('1. Follow me 2. Reply DONE'), { kind: 'reply', text: 'DONE' });
});

test('decide answers a check mark only after an instruction verb', () => {
  assert.deepStrictEqual(replyTo('Reply ✅'), { kind: 'reply', text: '✅' });
  assert.strictEqual(replyTo('All sorted ✅').kind, 'park');
});

// --- Review fixes: the attempt counter fails closed --------------------------

test('decide never replies on a corrupt reply_attempts, whatever the prompt', () => {
  for (const bad of [null, 'abc', '1', -5, -1, 1.5, NaN, Infinity, {}, []]) {
    const action = replyTo('reply DONE', { capture: { sender_username: 'c', reply_attempts: bad } });
    assert.deepStrictEqual(action, { kind: 'park', reason: 'freeform_gate' }, String(JSON.stringify(bad)));
  }
});

test('decide treats a corrupt counter like an exhausted one for follow gates too', () => {
  const action = replyTo('follow me then reply DONE',
    { capture: { sender_username: 'c', reply_attempts: -5 } });
  assert.deepStrictEqual(action, { kind: 'park', reason: 'follow_gate' });
});

test('decide still replies when reply_attempts is missing or a valid integer under the cap', () => {
  assert.strictEqual(replyTo('reply DONE', { capture: { sender_username: 'c' } }).kind, 'reply');
  assert.strictEqual(replyTo('reply DONE', { capture: { sender_username: 'c', reply_attempts: 0 } }).kind, 'reply');
  assert.strictEqual(replyTo('reply DONE', { capture: { sender_username: 'c', reply_attempts: 1 } }).kind, 'reply');
});

// --- Review round 3: two tables pin the behaviour, the rule is derived --------
//
// The reply rule is exactly what satisfies both tables below. Every string in
// PARKS once drew an automated reply from a matched creator's DM; every string
// in REPLIES is a real gate wording that must keep working. Add to a table only
// with a captured real message (REPLIES) or a real false positive (PARKS).

const PARKS = [
  'sorry for the late reply! yes of course',
  'sorry for the late reply, yes I saw it',
  "sorry for the late reply, send me your email and I'll sort it",
  'sorry for the slow reply, link below',
  'thanks for the comment! yes I will',
  'Thanks for your comment, link coming soon',
  'Thanks for the comment. Done and dusted',
  'Appreciate the comment! DONE deal',
  'I got your DM, yes I can help',
  'did you get my DM? yes I did',
  'Just saw your DM — yes!',
  'No need to reply. GO ahead and read it',
  'the reply DONE button is broken',
  "I'll comment done when I post it",
  'Did the DM send? yes',
  // Round 4: a keyword must CLOSE its instruction, only "me"/"with" may sit
  // between verb and keyword, and there is no digit pass.
  'Type 2 diabetes is reversible',
  'Type 2 diabetes',
  'Type 1 diabetes awareness month',
  'Comment 2 said the same thing',
  'Reply 2 was the one that stung',
  'Send 2 of those over whenever',
  'Send 3 and I will pick one',
  'DM sent ✅',
  'Comment posted ✅',
  'Reply received ✅',
  'Comment pinned ✅',
  "I'll take a look and send link",
  "I'll check with the team and reply yes or no",
  'let me look into it and send link tomorrow',
  'Send us LINK',
  'Send them LINK',
  'Send one LINK',
  'Send both LINK',
  'Send me 2 or 3 examples of what you tried',
  'Comment below ✅',
  'Reply 1 for the guide',
  'type 2 to continue',
  // Round 5: a determinerless "send link" is how a person asks for a link, not
  // a gate; and a check mark is paired only with "reply".
  'send link',
  'Send link',
  'send me link',
  'Send me LINK',
  'dm me link',
  'DM me LINK',
  'DM link',
  'send link to me',
  'pls send link',
  'ok, send link',
  'now send link',
  'send link for me',
  'send link to the group',
  'Comment ✅',
  'Send ✅',
  'DM ✅',
  'Type ✅',
];

const REPLIES = [
  ['Reply DONE', 'DONE'],
  ['Comment DONE below', 'DONE'],
  ['comment DONE 👇', 'DONE'],
  ['Just comment DONE 👇 and check your DMs', 'DONE'],
  ['Type YES', 'YES'],
  ['Type DONE to receive the free guide', 'DONE'],
  ['DM me GO', 'GO'],
  ['DM DONE for access', 'DONE'],
  ['To get the link, reply YES', 'YES'],
  ['Reply "DONE"', 'DONE'],
  ["Reply 'LINK' and I'll send it over", 'LINK'],
  ['reply ✅ to continue', '✅'],
  ['👉 REPLY DONE 👈', 'DONE'],
  ['Follow + reply DONE', 'DONE'],
  ['1. Follow me 2. Reply DONE', 'DONE'],
  ['To unlock, send DONE', 'DONE'],
  ['reply\nDONE', 'DONE'],
];

test('PARKS table: ordinary DM prose containing a keyword never draws a reply', () => {
  assert.strictEqual(PARKS.length, 54);
  for (const text of PARKS) {
    assert.deepStrictEqual(replyTo(text), { kind: 'park', reason: 'freeform_gate' }, JSON.stringify(text));
  }
});

test('REPLIES table: real gate wording is still answered, with the right word', () => {
  assert.strictEqual(REPLIES.length, 17);
  for (const [text, word] of REPLIES) {
    assert.deepStrictEqual(replyTo(text), { kind: 'reply', text: word }, JSON.stringify(text));
  }
});

test('the gate wording this rule deliberately leaves unanswered parks (for the tray)', () => {
  // Strict now, loosened only against captured real wording (Task 8).
  for (const text of ['Say DONE', 'Write DONE', 'Drop a YES below', 'Tap DONE']) {
    assert.deepStrictEqual(replyTo(text), { kind: 'park', reason: 'freeform_gate' }, text);
  }
});

test('a sentence boundary or line break ends the instruction', () => {
  assert.strictEqual(replyTo('Thanks for the comment\nDone and dusted').kind, 'park');
  assert.strictEqual(replyTo('Reply, DONE').kind, 'park');
  assert.strictEqual(replyTo('Comment. DONE').kind, 'park');
  assert.strictEqual(replyTo('Reply: DONE').kind, 'reply');
  assert.strictEqual(replyTo('reply 👉 DONE').kind, 'reply');
});

test('the verb must open the instruction: a noun use of reply/comment/DM does not', () => {
  assert.strictEqual(replyTo('my reply: yes').kind, 'park');
  assert.strictEqual(replyTo('your comment says go').kind, 'park');
  assert.strictEqual(replyTo('Send the link to me').kind, 'park');
});

test('a keyword must close its instruction: followed by more words it is a noun phrase', () => {
  assert.strictEqual(replyTo('Send LINK tomorrow').kind, 'park');
  assert.strictEqual(replyTo('Reply YES or NO').kind, 'park');
  assert.strictEqual(replyTo('Reply DONE below').kind, 'reply');
  assert.strictEqual(replyTo('Reply DONE to get it').kind, 'reply');
  assert.strictEqual(replyTo('Reply DONE for access').kind, 'reply');
  assert.strictEqual(replyTo('Reply DONE, thanks').kind, 'reply');
  assert.strictEqual(replyTo('Reply DONE\nand enjoy').kind, 'reply');
});

test('only "me" and "with" may sit between verb and keyword', () => {
  for (const gap of ['me', 'with']) assert.strictEqual(replyTo(`Reply ${gap} DONE`).kind, 'reply', gap);
  for (const gap of ['us', 'them', 'him', 'her', 'one', 'any', 'both', 'all', 'the', 'a', 'posted', 'received']) {
    assert.strictEqual(replyTo(`Send ${gap} LINK`).kind, 'park', gap);
  }
});

test('and/then end a clause but never open an instruction', () => {
  assert.strictEqual(replyTo('Follow me and reply DONE').kind, 'park');
  assert.strictEqual(replyTo('Follow me, then reply DONE').kind, 'reply');
  assert.strictEqual(replyTo('Follow me. Then reply DONE').kind, 'reply');
});

test('send+keyword pairs that are ordinary English park; reply+link stays reachable', () => {
  // "Send me YES and then DONE" used to reply YES; the send+yes pair is now rejected.
  for (const text of ['Send me YES and then DONE', 'send yes', 'Send GO', 'send send']) {
    assert.strictEqual(replyTo(text).kind, 'park', text);
  }
  // reply+link cannot be rejected: "Reply 'LINK' and I'll send it over" is a real gate.
  assert.deepStrictEqual(replyTo("Reply 'LINK' and I'll send it over"), { kind: 'reply', text: 'LINK' });
  assert.deepStrictEqual(replyTo('comment link below'), { kind: 'reply', text: 'LINK' });
});

test('a check mark is answered only after "reply"', () => {
  assert.deepStrictEqual(replyTo('reply ✅ to continue'), { kind: 'reply', text: '✅' });
  for (const verb of ['Comment', 'Send', 'DM', 'Type']) {
    assert.strictEqual(replyTo(`${verb} ✅`).kind, 'park', verb);
  }
});

// ─── A resolved url that is itself not an article ─────────────────────────────
// A short link reveals that it is a Linktree or an Instagram page only AFTER
// resolution, so decide() judges where the link ended up with the same mapping
// it applies to the links that came in. Matched creator or not.

const resolvedAs = (resolvedUrl, extra = {}) => decide({ ...fromC({ resolvedUrl }), event: { message: { text: 'x' } }, ...extra });

test('decide parks hub_page when the RESOLVED url is a linktree, even for a matched creator', () => {
  assert.deepStrictEqual(resolvedAs('https://linktr.ee/thecreator'), { kind: 'park', reason: 'hub_page' });
});

test('decide parks hub_page when the RESOLVED url is an instagram.com page', () => {
  assert.deepStrictEqual(resolvedAs('https://www.instagram.com/thecreator/'), { kind: 'park', reason: 'hub_page' });
});

test('decide parks unusable_link when the RESOLVED url is a cdninstagram.com media file', () => {
  assert.deepStrictEqual(resolvedAs('https://scontent.cdninstagram.com/v/x.jpg'), { kind: 'park', reason: 'unusable_link' });
  assert.deepStrictEqual(resolvedAs('https://scontent.fbcdn.net/v/x.mp4'), { kind: 'park', reason: 'unusable_link' });
});

test('decide parks unusable_link, not hub_page, when the RESOLVED url is a wrapper that never unwrapped', () => {
  assert.deepStrictEqual(resolvedAs('https://l.instagram.com/?u=junk'), { kind: 'park', reason: 'unusable_link' });
});

test('decide judges a RESOLVED hub before the creator: unsaved creator is hub_page, not no_match', () => {
  const unsaved = decide({ ...base, capture: { ...base.capture, sender_username: 'nobody' },
    candidates: [reel('c', '2026-11-01T10:00:00Z')], resolvedUrl: 'https://beacons.ai/nobody',
    event: { message: { text: 'x' } } });
  assert.deepStrictEqual(unsaved, { kind: 'park', reason: 'hub_page' });
});

test('decide still attaches an ordinary RESOLVED article, and a hub-looking path on a real host is fine', () => {
  assert.strictEqual(resolvedAs('https://example.com/linktr.ee/guide').kind, 'attach');
  assert.strictEqual(resolvedAs('https://notinstagram.com/guide').kind, 'attach');
});
