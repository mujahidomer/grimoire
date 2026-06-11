const { google } = require('googleapis');
const { getAuth } = require('./auth');

const SUBFOLDERS = [
  'Food & Cooking',
  'Technology',
  'Health & Fitness',
  'Finance',
  'Learning & Education',
  'Entertainment',
  'Travel',
  'Business & Career',
  'Personal Development',
  'Other'
];

async function initialize() {
  console.log('🔧 Initializing Grimoire...');
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });
  const sheets = google.sheets({ version: 'v4', auth });

  const rootFolderId = process.env.DRIVE_ROOT_FOLDER_ID;
  if (!rootFolderId) throw new Error('DRIVE_ROOT_FOLDER_ID is not set');

  const folderIds = {};
  for (const name of SUBFOLDERS) {
    const id = await getOrCreateFolder(drive, name, rootFolderId);
    folderIds[name.toLowerCase()] = id;
    console.log(`📁 Folder ready: ${name}`);
  }

  const sheetId = await getOrCreateSheet(drive, sheets, rootFolderId);
  await ensureRegistryColumns(sheets, sheetId);
  console.log('📊 Registry sheet ready');
  console.log('✅ Grimoire initialized');

  return { folderIds, sheetId };
}

async function getOrCreateFolder(drive, name, parentId) {
  const res = await drive.files.list({
    q: `name='${name}' and '${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
    fields: 'files(id)'
  });

  if (res.data.files.length > 0) return res.data.files[0].id;

  const folder = await drive.files.create({
    requestBody: {
      name,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentId]
    },
    fields: 'id'
  });

  return folder.data.id;
}

async function getOrCreateSheet(drive, sheets, parentId) {
  if (process.env.SHEET_ID) return process.env.SHEET_ID;

  const res = await drive.files.list({
    q: `name='Grimoire Registry' and '${parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id)'
  });

  if (res.data.files.length > 0) return res.data.files[0].id;

  const file = await drive.files.create({
    requestBody: {
      name: 'Grimoire Registry',
      mimeType: 'application/vnd.google-apps.spreadsheet',
      parents: [parentId]
    },
    fields: 'id'
  });

  const sheetId = file.data.id;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Sheet1!A1:J1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Title', 'Category', 'Tags', 'Type', 'Summary', 'Source URL', 'Date Saved', 'Drive File Link', 'Drive File ID', 'Confirmation Message ID']]
    }
  });

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{
        repeatCell: {
          range: { sheetId: 0, startRowIndex: 0, endRowIndex: 1 },
          cell: { userEnteredFormat: { textFormat: { bold: true } } },
          fields: 'userEnteredFormat.textFormat.bold'
        }
      }]
    }
  });

  return sheetId;
}

// Idempotent migration: older sheets only have headers A-H
async function ensureRegistryColumns(sheets, sheetId) {
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!I1:J1'
  });
  const headers = res.data.values?.[0] || [];
  if (headers[0] && headers[1]) return;

  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: 'Sheet1!I1:J1',
    valueInputOption: 'RAW',
    requestBody: { values: [['Drive File ID', 'Confirmation Message ID']] }
  });
}

module.exports = { initialize };
