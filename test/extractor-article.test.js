// extractArticle has two jobs beyond calling Jina: read a GitHub repo from the
// API instead (the README as written, no Jina quota spent), and wait out the
// refusals Jina's free tier returns to a burst instead of recording them as a
// permanently unreadable page. Both are exercised against a fake fetch — no
// network.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const extractor = () => import(path.resolve(__dirname, '../lib/extractor.js'));

const ok = (body) => ({ ok: true, status: 200, text: async () => body });
const fail = (status) => ({ ok: false, status, text: async () => '' });
const noSleep = () => Promise.resolve();

test('a GitHub repo URL is read from the API, never through Jina', async () => {
  const { extractArticle } = await extractor();
  const seen = [];
  const result = await extractArticle('https://github.com/Nutlope/hallmark', {
    fetchImpl: async (url) => {
      seen.push(url);
      return ok('# Hallmark\n\nA design skill that refuses to look AI-generated.');
    },
    sleep: noSleep,
  });

  assert.deepEqual(seen, ['https://api.github.com/repos/Nutlope/hallmark/readme']);
  assert.equal(result.title, 'Hallmark');
  assert.match(result.text, /design skill/);
});

test('a trailing slash, .git suffix and query string still read as the repo', async () => {
  const { extractGithubReadme } = await extractor();
  for (const url of [
    'https://github.com/owner/repo',
    'https://github.com/owner/repo/',
    'https://github.com/owner/repo.git',
    'https://www.github.com/owner/repo?tab=readme-ov-file',
  ]) {
    const seen = [];
    await extractGithubReadme(url, {
      fetchImpl: async (u) => { seen.push(u); return ok('# Repo\n\nbody'); },
    });
    assert.deepEqual(seen, ['https://api.github.com/repos/owner/repo/readme'], url);
  }
});

test('a path inside a repo is not a repo root, so Jina handles it', async () => {
  const { extractGithubReadme } = await extractor();
  const deeper = await extractGithubReadme('https://github.com/owner/repo/blob/main/README.md', {
    fetchImpl: async () => { throw new Error('should not be called'); },
  });
  assert.equal(deeper, null);
});

test('a repo with no README falls through to Jina rather than failing', async () => {
  const { extractArticle } = await extractor();
  const seen = [];
  const result = await extractArticle('https://github.com/owner/empty', {
    fetchImpl: async (url) => {
      seen.push(url);
      return url.startsWith('https://api.github.com') ? fail(404) : ok('Title: owner/empty\n\nrendered page');
    },
    sleep: noSleep,
  });

  assert.equal(seen.length, 2);
  assert.match(seen[1], /^https:\/\/r\.jina\.ai\//);
  assert.equal(result.title, 'owner/empty');
});

test('a README that is only whitespace is treated as absent', async () => {
  const { extractGithubReadme } = await extractor();
  const result = await extractGithubReadme('https://github.com/owner/repo', {
    fetchImpl: async () => ok('   \n\n  '),
  });
  assert.equal(result, null);
});

test('Jina 403 is retried, and the retry\'s content is returned', async () => {
  const { extractArticle } = await extractor();
  let calls = 0;
  const waited = [];
  const result = await extractArticle('https://example.com/post', {
    fetchImpl: async () => (++calls === 1 ? fail(403) : ok('Title: Post\n\nbody')),
    sleep: async (ms) => { waited.push(ms); },
  });

  assert.equal(calls, 2);
  assert.equal(waited.length, 1);
  assert.equal(result.title, 'Post');
});

test('a status that will not change is not retried', async () => {
  const { extractArticle } = await extractor();
  let calls = 0;
  await assert.rejects(
    extractArticle('https://example.com/gone', {
      fetchImpl: async () => { calls++; return fail(404); },
      sleep: noSleep,
    }),
    /Jina error 404/,
  );
  assert.equal(calls, 1);
});

test('a refusal that never lets up reports the status it saw', async () => {
  const { extractArticle } = await extractor();
  let calls = 0;
  await assert.rejects(
    extractArticle('https://example.com/post', {
      fetchImpl: async () => { calls++; return fail(429); },
      sleep: noSleep,
    }),
    /Jina error 429/,
  );
  assert.equal(calls, 3);
});
