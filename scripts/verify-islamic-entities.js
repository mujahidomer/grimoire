// Backfill: verify + enrich all dua / hadith / quranic_verse entities against
// canonical sources (quran.com, sunnah.com dataset).
//
//   node scripts/verify-islamic-entities.js                → dry run, prints report
//   node scripts/verify-islamic-entities.js --report out.json  → dry run + full JSON report
//   node scripts/verify-islamic-entities.js --write        → applies updates to items.entities
//   node scripts/verify-islamic-entities.js --only <item_id>   → limit to one item
require('dotenv').config();
const fs = require('fs');
const { getSupabase } = require('../lib/supabase');
const { verifyEntity } = require('../lib/passageVerification');

const TYPES = ['dua', 'hadith', 'quranic_verse'];

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] || true);
}

async function main() {
  const write = process.argv.includes('--write');
  const reportPath = arg('--report');
  const only = arg('--only');

  const sb = getSupabase();
  let query = sb.from('items').select('id, title, entities').not('entities', 'is', null);
  if (only) query = query.eq('id', only);
  const { data: items, error } = await query;
  if (error) throw error;

  const reports = [];
  let updatedItems = 0;

  for (const item of items) {
    const entities = item.entities || [];
    if (!entities.some(e => e && TYPES.includes(e.type))) continue;

    console.log(`\n■ ${item.title} (${item.id})`);
    const updatedEntities = [];
    let itemChanged = false;

    for (const entity of entities) {
      if (!entity || !TYPES.includes(entity.type)) {
        updatedEntities.push(entity);
        continue;
      }
      if (entity.detail?.verification?.status && !process.argv.includes('--recheck')) {
        console.log(`  ↷ ${entity.name} — already checked (${entity.detail.verification.status})`);
        updatedEntities.push(entity);
        continue;
      }
      try {
        const { updated, report } = await verifyEntity(entity, { log: m => console.log(m) });
        console.log(`  ${statusIcon(report.status)} [${entity.type}] ${entity.name}`);
        if (report.reference) console.log(`     → ${report.reference}  ${report.source_url || ''}`);
        if (report.changed.length) console.log(`     fixed: ${report.changed.join(', ')}`);
        for (const issue of report.issues) console.log(`     issue: ${issue}`);
        if (report.notes) console.log(`     note: ${report.notes}`);
        reports.push({ item_id: item.id, item_title: item.title, ...report });
        updatedEntities.push(updated);
        itemChanged = true;
      } catch (err) {
        console.log(`  ✗ [${entity.type}] ${entity.name} — verification errored: ${err.message}`);
        reports.push({ item_id: item.id, item_title: item.title, name: entity.name, type: entity.type, status: 'error', error: err.message });
        updatedEntities.push(entity);
      }
    }

    if (write && itemChanged) {
      const { error: updErr } = await sb.from('items').update({ entities: updatedEntities }).eq('id', item.id);
      if (updErr) throw new Error(`update failed for ${item.id}: ${updErr.message}`);
      updatedItems++;
    }
  }

  const counts = {};
  for (const r of reports) counts[r.status] = (counts[r.status] || 0) + 1;
  console.log(`\n═══ summary ═══`);
  console.log(JSON.stringify(counts, null, 2));
  console.log(write ? `items updated: ${updatedItems}` : 'DRY RUN — nothing written (pass --write to apply)');

  if (reportPath) {
    fs.writeFileSync(reportPath, JSON.stringify(reports, null, 2));
    console.log(`full report: ${reportPath}`);
  }
}

function statusIcon(status) {
  return { verified: '✓', corrected: '✎', unsourced: '◌', needs_review: '⚠', error: '✗' }[status] || '?';
}

main().catch(e => { console.error(e); process.exit(1); });
