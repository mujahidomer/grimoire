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

let saved, upserts, extractImpl;

beforeEach(() => {
  saved = {};
  upserts = [];
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

test('content_extracted is false for empty or whitespace-only text', async () => {
  extractImpl = async () => ({ text: '   \n', title: 'T' });
  assert.strictEqual((await attach()).content_extracted, false);
  extractImpl = async () => null;
  assert.strictEqual((await attach()).content_extracted, false);
});
