// A bot wall answers 200, so a blocked read reaches the classifier looking like
// a successful one. The text in BOT_WALL below is what Jina actually returned
// for dango.kit.com on 2026-11-05 — the page that ended up attached to sixteen
// reels — so these tests pin the detector to real captured output, not a guess.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const extractor = () => import(path.resolve(__dirname, '../lib/extractor.js'));

const BOT_WALL = `Title: Just a moment...

URL Source: https://dango.kit.com/workout-to-lose-belly-fat

Warning: This page maybe requiring CAPTCHA, please make sure you are authorized to access this page.

Markdown Content:
Are you a robot? 🤖

Hey There! Sorry for the inconvenience, but we need to confirm you're not a robot.`;

const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const noSleep = () => Promise.resolve();

test('the real captured bot wall is detected', async () => {
  const { detectBlockedPage } = await extractor();
  assert.match(detectBlockedPage(BOT_WALL), /CAPTCHA/);
});

test('a challenge page with no Jina warning is still detected by its phrase and thin body', async () => {
  const { detectBlockedPage } = await extractor();
  const page = `Title: Attention Required! | Cloudflare

Markdown Content:
Checking your browser before accessing the site.`;
  assert.match(detectBlockedPage(page), /challenge page/);
});

test('an article that discusses CAPTCHAs is not treated as blocked', async () => {
  const { detectBlockedPage } = await extractor();
  const body = 'Are you a robot? That question has a long history. '.repeat(40);
  assert.strictEqual(detectBlockedPage(`Title: The history of the CAPTCHA

Markdown Content:
${body}`), null);
});

test('a short but real page is not treated as blocked', async () => {
  const { detectBlockedPage } = await extractor();
  const page = `Title: My workout plan

Markdown Content:
Three sets of eight. Rest ninety seconds. Add weight every week.`;
  assert.strictEqual(detectBlockedPage(page), null);
});

test('empty input is not a blocked page', async () => {
  const { detectBlockedPage } = await extractor();
  assert.strictEqual(detectBlockedPage(''), null);
  assert.strictEqual(detectBlockedPage(null), null);
});

test('extractArticle throws a flagged error for a bot wall, and does not retry it', async () => {
  const { extractArticle } = await extractor();
  let calls = 0;
  await assert.rejects(
    () => extractArticle('https://dango.kit.com/workout-to-lose-belly-fat', {
      fetchImpl: async () => { calls++; return ok(BOT_WALL); },
      sleep: noSleep,
    }),
    (err) => {
      assert.strictEqual(err.blocked, true);
      assert.match(err.message, /Blocked page/);
      return true;
    },
  );
  assert.strictEqual(calls, 1, 'a bot wall returns the same page next time; retrying only costs quota');
});

test('a readable page still comes back normally', async () => {
  const { extractArticle } = await extractor();
  const page = `Title: Real Article

Markdown Content:
${'Something worth reading. '.repeat(50)}`;
  const result = await extractArticle('https://example.com/a', {
    fetchImpl: async () => ok(page),
    sleep: noSleep,
  });
  assert.strictEqual(result.title, 'Real Article');
  assert.match(result.text, /worth reading/);
});
