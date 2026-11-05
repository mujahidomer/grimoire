// attachLinkedResource must say whether extraction produced text, so a caller
// can tell "attached with content" from "attached, page unreadable". The
// collaborators are stubbed through the require cache (restored afterwards):
// no network, no database, no LLM.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const LIB = path.resolve(__dirname, '../lib');
const STUBBED = ['extractor', 'classifier', 'repository', 'entityResolution',
  'passageVerification', 'placeGeocoding', 'entityUrlResolution', 'linkedResources'];
const key = (name) => require.resolve(path.join(LIB, name));

let saved, upserts, extractImpl, conflictImpl;

beforeEach(() => {
  saved = {};
  upserts = [];
  conflictImpl = async () => null;
  for (const name of STUBBED) saved[name] = require.cache[key(name)];
  const stub = (name, exports) => {
    require.cache[key(name)] = { id: key(name), filename: key(name), loaded: true, exports };
  };
  stub('extractor', { extractContent: (url) => extractImpl(url) });
  stub('classifier', {
    processLinkedResource: async (text, title) => ({ title: title || 'untitled', resource_type: 'article', content: text }),
    extractEntities: async () => [],
  });
  stub('repository', {
    upsertLinkedResource: async (itemId, userId, row) => { upserts.push(row); },
    mergeItemEntities: async () => ({ added: 0 }),
    getItemById: async () => ({ linked_resources: [{ source_url: 'u' }] }),
    getSubcategoryVocabulary: async () => [],
    linkedResourceCreatorConflict: (...args) => conflictImpl(...args),
  });
  stub('entityResolution', { resolveEntities: async () => {} });
  stub('passageVerification', { verifyItemEntitiesInBackground() {} });
  stub('placeGeocoding', { geocodeItemEntitiesInBackground() {} });
  stub('entityUrlResolution', { resolveEntityUrlsInBackground() {} });
  delete require.cache[key('linkedResources')];
});

afterEach(() => {
  for (const name of STUBBED) {
    if (saved[name]) require.cache[key(name)] = saved[name]; else delete require.cache[key(name)];
  }
});

const attach = () => require(path.join(LIB, 'linkedResources')).attachLinkedResource('item', 'user', 'https://example.com/a');

test('content_extracted is true when extraction produced text, and linked_resources is unchanged', async () => {
  extractImpl = async () => ({ text: 'The article body', title: 'T' });
  const out = await attach();
  assert.strictEqual(out.content_extracted, true);
  assert.deepStrictEqual(out.linked_resources, [{ source_url: 'u' }]);
});

test('content_extracted is false when extraction throws; the resource is still attached', async () => {
  const realErr = console.error; console.error = () => {};
  extractImpl = async () => { throw new Error('blocked'); };
  try {
    const out = await attach();
    assert.strictEqual(out.content_extracted, false);
    assert.strictEqual(upserts.length, 1);
  } finally { console.error = realErr; }
});

// The two reasons to attach nothing at all, both found on one CAPTCHA-walled
// tracker that sixteen reels pointed at (2026-11-05).
test('a page we were blocked from reading is not attached', async () => {
  const realErr = console.error, realWarn = console.warn;
  console.error = () => {}; console.warn = () => {};
  extractImpl = async () => {
    const err = new Error('Blocked page at https://example.com/a: Jina reported a CAPTCHA challenge');
    err.blocked = true;
    throw err;
  };
  try {
    const out = await attach();
    assert.strictEqual(upserts.length, 0, 'no row for a page we could not read');
    assert.strictEqual(out.content_extracted, false);
    assert.strictEqual(out.skipped, 'blocked_page');
    assert.deepStrictEqual(out.linked_resources, [{ source_url: 'u' }]);
  } finally { console.error = realErr; console.warn = realWarn; }
});

test('an ordinary extraction failure is still attached — only a blocked page is skipped', async () => {
  const realErr = console.error; console.error = () => {};
  extractImpl = async () => { throw new Error('socket hang up'); };
  try {
    const out = await attach();
    assert.strictEqual(upserts.length, 1);
    assert.strictEqual(out.skipped, undefined);
  } finally { console.error = realErr; }
});

test('a URL another creator already holds is not attached', async () => {
  const realWarn = console.warn; console.warn = () => {};
  extractImpl = async () => ({ text: 'The article body', title: 'T' });
  conflictImpl = async () => 'liamjohnston.ai';
  try {
    const out = await attach();
    assert.strictEqual(upserts.length, 0);
    assert.strictEqual(out.skipped, 'other_creator');
    assert.strictEqual(out.content_extracted, false);
  } finally { console.warn = realWarn; }
});

test('the conflict check is asked about this item and this URL', async () => {
  extractImpl = async () => ({ text: 'The article body', title: 'T' });
  const asked = [];
  conflictImpl = async (...args) => { asked.push(args); return null; };
  await attach();
  assert.deepStrictEqual(asked, [['user', 'item', 'https://example.com/a']]);
  assert.strictEqual(upserts.length, 1);
});

test('content_extracted is false for empty or whitespace-only text', async () => {
  extractImpl = async () => ({ text: '   \n', title: 'T' });
  assert.strictEqual((await attach()).content_extracted, false);
  extractImpl = async () => null;
  assert.strictEqual((await attach()).content_extracted, false);
});
