#!/usr/bin/env node
// One-time Drive → Postgres migration (Doc A items 4 + 8).
//
// Reads the existing MD files from Google Drive (using the Drive File IDs in the
// current Sheets registry), parses front-matter + body sections + stacked
// "## Linked Resource" blocks, and inserts structured rows into Postgres. The
// deprecated drive_file_* columns are populated on migrated rows for traceability
// (left null on all future rows). '?' tag markers become item_tags.confidence_pending.
// Every migrated item is embedded so the pre-populated library is immediately
// searchable.
//
// Usage:
//   node scripts/migrate-drive-to-postgres.js          # full run
//   node scripts/migrate-drive-to-postgres.js --dry-run # parse only, no writes
//   node scripts/migrate-drive-to-postgres.js --limit 5 # first N rows
//   node scripts/migrate-drive-to-postgres.js --no-embed
//
// Requires: Drive/Sheets creds (OAUTH_*, GOOGLE_CREDENTIALS), SHEET_ID or
// DRIVE_ROOT_FOLDER_ID, SUPABASE_*, GRIMOIRE_USER_ID, and OPENAI_API_KEY (unless
// --no-embed). Re-runnable: upserts key on (user_id, source_url).

require('dotenv').config();
const { google } = require('googleapis');
const { getAuth } = require('../lib/auth');
const { parseMarkdown } = require('../lib/md-parse');
const {
  upsertItem, upsertItemTags, upsertLinkedResource
} = require('../lib/repository');
const { embedAndStoreItem } = require('../lib/embeddings');
const { defaultUserId } = require('../lib/supabase');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const NO_EMBED = args.includes('--no-embed');
const LIMIT = (() => {
  const i = args.indexOf('--limit');
  return i !== -1 ? parseInt(args[i + 1], 10) : Infinity;
})();

async function resolveSheetId(drive) {
  if (process.env.SHEET_ID) return process.env.SHEET_ID;
  const root = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!root) throw new Error('Set SHEET_ID or DRIVE_ROOT_FOLDER_ID.');
  const res = await drive.files.list({
    q: `name='Grimoire Registry' and '${root}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id)'
  });
  if (!res.data.files.length) throw new Error('Could not find the "Grimoire Registry" sheet.');
  return res.data.files[0].id;
}

// Recover a Drive file id from a "Drive File Link" cell when the dedicated ID
// column is empty (older registry rows only have the link, with the id embedded:
// https://drive.google.com/file/d/<ID>/view?...).
function fileIdFromLink(link) {
  if (!link) return null;
  const m = String(link).match(/\/d\/([A-Za-z0-9_-]+)/) || String(link).match(/[?&]id=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function downloadFile(drive, fileId) {
  const res = await drive.files.get({ fileId, alt: 'media' });
  return typeof res.data === 'string' ? res.data : String(res.data);
}

async function main() {
  const userId = defaultUserId();
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  const sheetId = await resolveSheetId(drive);
  console.log(`📊 Reading registry ${sheetId}`);

  const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: 'Sheet1!A:K' });
  const rows = (res.data.values || []).slice(1); // drop header
  console.log(`Found ${rows.length} registry rows. ${DRY_RUN ? '(dry run)' : ''}`);

  let migrated = 0, skipped = 0, failed = 0;

  for (const row of rows) {
    if (migrated >= LIMIT) break;
    // Prefer the dedicated Drive File ID column; fall back to the id embedded in
    // the Drive File Link (older rows only have the link).
    const driveFileLink = row[7];
    const driveFileId = row[8] || fileIdFromLink(driveFileLink);
    if (!driveFileId) { skipped++; continue; }

    try {
      const content = await downloadFile(drive, driveFileId);
      const parsed = parseMarkdown(content);
      const fm = parsed.frontMatter || {};

      // The MD front-matter is the source of truth — the registry sheet's column
      // layout varies between schema generations, so positional cell fallbacks
      // are unsafe. Only the title falls back to col 0 (stable across schemas).
      const sourceUrl = fm.source_url;
      if (!sourceUrl) { console.warn(`  ⚠️ no source_url in front-matter for ${driveFileId} — skipping`); skipped++; continue; }

      const input = {
        title: fm.title || row[0] || 'Untitled',
        category: fm.category || 'Other',
        type: fm.type || 'article',
        source_url: sourceUrl,
        date_saved: fm.date_saved || null,
        summary: parsed.summary || null,
        key_takeaways: parsed.keyTakeaways,
        transcript: parsed.transcript || null,
        caption: parsed.caption || null,
        artifact_type: fm.artifact_type || 'none',
        artifact_name: fm.artifact_name || null,
        artifact_url: fm.artifact_url || null,
        artifact_url_source: fm.artifact_url_source || null,
        drive_file_id: driveFileId,
        drive_file_link: driveFileLink || null,
        source: 'telegram'
      };

      const tags = Array.isArray(fm.tags) ? fm.tags.map(String) : [];

      if (DRY_RUN) {
        console.log(`  • ${input.title} — ${tags.length} tags, ${parsed.linkedResources.length} linked, ${parsed.keyTakeaways.length} takeaways`);
        migrated++;
        continue;
      }

      const itemId = await upsertItem(input, { userId, source: 'telegram' });
      await upsertItemTags(itemId, userId, tags);
      for (const lr of parsed.linkedResources) {
        await upsertLinkedResource(itemId, userId, lr);
      }
      if (!NO_EMBED) {
        await embedAndStoreItem(input, itemId, userId);
      }

      migrated++;
      console.log(`  ✅ ${input.title}`);
    } catch (err) {
      failed++;
      console.error(`  ❌ ${driveFileId}: ${err.message}`);
    }
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`);
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1); });
