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

  // Create new folder structure
  const folderIds = {};
  for (const name of SUBFOLDERS) {
    const id = await getOrCreateFolder(drive, name, rootFolderId);
    folderIds[name.toLowerCase()] = id;
    console.log(`📁 Folder ready: ${name}`);
  }

  // Migrate files from old folders to new structure
  await migrateOldFolders(drive, rootFolderId, folderIds);

  // Get or create registry sheet
  const sheetId = await getOrCreateSheet(drive, sheets, rootFolderId);
  console.log('📊 Registry sheet ready');
  console.log('✅ Grimoire initialized');

  return { folderIds, sheetId };
}

async function migrateOldFolders(drive, rootFolderId, folderIds) {
  // Old folder names → new folder mapping
  const migrations = {
    'Markdown': folderIds.prompts,
    'Agents': folderIds.connectors,
    'Installed': null // delete contents, remove folder
  };

  for (const [oldName, newFolderId] of Object.entries(migrations)) {
    const res = await drive.files.list({
      q: `name='${oldName}' and '${rootFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      fields: 'files(id, name)'
    });

    if (res.data.files.length === 0) continue;
    const oldFolderId = res.data.files[0].id;

    if (newFolderId) {
      // Move all files from old folder to new folder
      const files = await drive.files.list({
        q: `'${oldFolderId}' in parents and trashed=false`,
        fields: 'files(id, name)'
      });

      for (const file of files.data.files) {
        await drive.files.update({
          fileId: file.id,
          addParents: newFolderId,
          removeParents: oldFolderId,
          fields: 'id'
        });
        console.log(`📦 Migrated: ${file.name} → ${newFolderId === folderIds.prompts ? 'Prompts' : 'Connectors'}`);
      }
    }

    // Trash the old empty folder
    await drive.files.update({
      fileId: oldFolderId,
      requestBody: { trashed: true }
    });
    console.log(`🗑️ Removed old folder: ${oldName}`);
  }
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
  const res = await drive.files.list({
    q: `name='Grimoire Registry' and '${parentId}' in parents and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false`,
    fields: 'files(id)'
  });

  if (res.data.files.length > 0) {
    // Check if SHEET_ID env var is set (manually created sheet)
    if (process.env.SHEET_ID) return process.env.SHEET_ID;
    return res.data.files[0].id;
  }

  if (process.env.SHEET_ID) return process.env.SHEET_ID;

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
