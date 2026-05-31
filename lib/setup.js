const { google } = require('googleapis');
const { getAuth } = require('./auth');

const SUBFOLDERS = ['Skills', 'MCPs', 'Connectors', 'Prompts', 'Insights'];

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
    range: 'Sheet1!A1:H1',
    valueInputOption: 'RAW',
    requestBody: {
      values: [['Skill Name', 'Type', 'Category', 'Description', 'Source URL', 'Date Saved', 'Status', 'Drive File Link']]
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

module.exports = { initialize };
