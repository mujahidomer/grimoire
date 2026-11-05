// recentInstagramItems builds the candidate window the DM matcher runs on, and
// the filtering happens in Postgres — so what is testable here, and what
// actually broke, is the query it asks for. A save-date-only window did not
// hold a reel saved months ago that the gate bot commented on today, so the
// article the creator DMed back parked as no_match.
//
// The supabase module is stubbed through the require cache (restored
// afterwards): no network, no database.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

const SUPABASE = require.resolve(path.resolve(__dirname, '../lib/supabase'));
const USER = '00000000-0000-0000-0000-000000000001';

let saved, calls;

// Records every filter the chain is asked for; range ends it with an empty page,
// which is also what stops recentInstagramItems' paging loop after one pass.
function fakeSupabase() {
  const chain = {};
  for (const name of ['from', 'select', 'eq', 'ilike', 'or', 'gte', 'lte', 'order']) {
    chain[name] = (...args) => { calls.push([name, ...args]); return chain; };
  }
  chain.range = (...args) => { calls.push(['range', ...args]); return Promise.resolve({ data: [], error: null }); };
  return chain;
}

beforeEach(() => {
  calls = [];
  saved = require.cache[SUPABASE];
  require.cache[SUPABASE] = {
    id: SUPABASE, filename: SUPABASE, loaded: true,
    exports: { getSupabase: () => fakeSupabase() },
  };
  delete require.cache[require.resolve(path.resolve(__dirname, '../lib/repository'))];
});

afterEach(() => {
  if (saved) require.cache[SUPABASE] = saved; else delete require.cache[SUPABASE];
  delete require.cache[require.resolve(path.resolve(__dirname, '../lib/repository'))];
});

const run = (opts) => require(path.resolve(__dirname, '../lib/repository'))
  .recentInstagramItems(USER, opts);

const find = (name) => calls.find((c) => c[0] === name);

test('the window asks for recently saved OR recently commented, as one or()', async () => {
  await run({ days: 7 });
  const or = find('or');
  assert.ok(or, 'the candidate window must be an or(), not a single gte');
  assert.match(or[1], /date_saved\.gte\./);
  assert.match(or[1], /gate_commented_at\.gte\./);
});

test('date_saved is not also a standalone gte — that would AND away the or', async () => {
  await run({ days: 7 });
  const gte = calls.filter((c) => c[0] === 'gte' && c[1] === 'date_saved');
  assert.deepStrictEqual(gte, [], 'a top-level gte on date_saved re-excludes old saves');
});

test('both halves of the window use the same `days` cutoff', async () => {
  await run({ days: 7 });
  const [, expr] = find('or');
  const [savedHalf, commentedHalf] = expr.split(',');
  const day = savedHalf.replace('date_saved.gte.', '');
  const iso = commentedHalf.replace('gate_commented_at.gte.', '');
  assert.strictEqual(iso.slice(0, 10), day, 'the two cutoffs must be the same moment');
  const ageDays = (Date.now() - Date.parse(iso)) / 86400000;
  assert.ok(ageDays > 6.9 && ageDays < 7.1, `cutoff should be ~7 days old, was ${ageDays}`);
});

test('a longer window moves both cutoffs together', async () => {
  await run({ days: 30 });
  const [, expr] = find('or');
  const iso = expr.split(',')[1].replace('gate_commented_at.gte.', '');
  const ageDays = (Date.now() - Date.parse(iso)) / 86400000;
  assert.ok(ageDays > 29.9 && ageDays < 30.1, `cutoff should be ~30 days old, was ${ageDays}`);
});

// The items table holds twelve users; a widened window must not widen the
// tenant filter with it.
test('the query stays scoped to one user and to Instagram', async () => {
  await run({ days: 7 });
  assert.deepStrictEqual(find('eq'), ['eq', 'user_id', USER]);
  assert.deepStrictEqual(find('ilike'), ['ilike', 'source_url', '%instagram.com%']);
});

test('a missing userId is refused rather than run unfiltered', async () => {
  const { recentInstagramItems } = require(path.resolve(__dirname, '../lib/repository'));
  await assert.rejects(() => recentInstagramItems(null), /requires a userId/);
  assert.deepStrictEqual(calls, [], 'nothing may reach the database without a user');
});
