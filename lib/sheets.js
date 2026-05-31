const { google } = require('googleapis');
const { getAuth } = require('./auth');

async function addToRegistry(item, sourceUrl, fileResult, sheetId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const row = [
    item.skillName,
    item.type,
    item.category,
    item.description,
    sourceUrl,
    new Date().toISOString().split('T')[0],
    'Saved',
    fileResult.webViewLink || ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:H',
    valueInputOption: 'RAW',
    requestBody: { values: [row] }
  });
}

async function updateStatus(sheetId, skillName, newStatus) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Find the row with matching skill name
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:A'
  });

  const rows = res.data.values || [];
  const rowIndex = rows.findIndex(row => row[0] === skillName);

  if (rowIndex === -1) return false;

  // Update status column (G = index 6, 1-based row = rowIndex + 1)
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `Sheet1!G${rowIndex + 1}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[newStatus]] }
  });

  return true;
}

module.exports = { addToRegistry, updateStatus };
