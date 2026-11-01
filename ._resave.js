// One-off: replay every status='failed' item through the real /api/save path.
// Serial, with polling, so Apify/Anthropic never see a burst.
require('dotenv').config();
const { getSupabase, defaultUserId } = require('./lib/supabase');

const BASE = process.env.RESAVE_BASE || 'http://localhost:3001';
const USER = defaultUserId();
const sb = getSupabase();
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function statusOf(url) {
  const { data } = await sb.from('items').select('status,title,summary')
    .eq('user_id', USER).eq('source_url', url).maybeSingle();
  return data;
}

(async () => {
  const { data: failed } = await sb.from('items').select('source_url')
    .eq('status', 'failed').order('created_at', { ascending: true });
  console.log(`replaying ${failed.length} failed items\n`);

  const done = [], stuck = [];
  for (const [i, row] of failed.entries()) {
    const url = row.source_url;
    const label = `[${String(i + 1).padStart(2)}/${failed.length}]`;
    try {
      const res = await fetch(`${BASE}/api/save`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-user-id': USER },
        body: JSON.stringify({ url }),
      });
      if (!res.ok) { console.log(`${label} POST ${res.status} — ${url}`); stuck.push(url); continue; }
    } catch (e) { console.log(`${label} POST failed: ${e.message}`); stuck.push(url); continue; }

    let s = null;
    for (let t = 0; t < 80; t++) {           // up to ~4 min
      await sleep(3000);
      s = await statusOf(url);
      if (s && s.status !== 'pending' && s.status !== 'processing') break;
    }
    if (s && s.status === 'completed' && s.summary) {
      console.log(`${label} ok   ${(s.title || '').slice(0, 58)}`);
      done.push(url);
    } else {
      console.log(`${label} FAIL ${s ? s.status : 'timeout'} — ${url}`);
      stuck.push(url);
    }
  }
  console.log(`\nrecovered ${done.length}/${failed.length}`);
  if (stuck.length) { console.log('still failing:'); stuck.forEach(u => console.log('  ' + u)); }
})();
