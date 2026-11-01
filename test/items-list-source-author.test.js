// The list endpoints must select source_author (full and lite shapes): the DM
// tray's reel picker narrows to the capture's sender with it. Supabase is
// stubbed with a chainable recorder; no database.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const supabasePath = require.resolve(path.resolve(__dirname, '../lib/supabase'));
const repoPath = require.resolve(path.resolve(__dirname, '../lib/repository'));

async function selectedColumns(lite) {
  const savedSb = require.cache[supabasePath];
  const savedRepo = require.cache[repoPath];
  let selected = null;
  const chain = new Proxy({}, {
    get(_t, prop) {
      if (prop === 'then') return (resolve) => resolve({ data: [], error: null });
      if (prop === 'select') return (cols) => { selected = cols; return chain; };
      return () => chain;
    },
  });
  require.cache[supabasePath] = {
    id: supabasePath, filename: supabasePath, loaded: true,
    exports: { getSupabase: () => ({ from: () => chain }), defaultUserId: () => 'u' },
  };
  delete require.cache[repoPath];
  try {
    await require(repoPath).getItems({ userId: 'u', lite });
    return selected;
  } finally {
    if (savedSb) require.cache[supabasePath] = savedSb; else delete require.cache[supabasePath];
    if (savedRepo) require.cache[repoPath] = savedRepo; else delete require.cache[repoPath];
  }
}

test('getItems selects source_author in the full shape', async () => {
  assert.match(await selectedColumns(false), /\bsource_author\b/);
});

test('getItems selects source_author in the lite shape the app uses', async () => {
  assert.match(await selectedColumns(true), /\bsource_author\b/);
});
