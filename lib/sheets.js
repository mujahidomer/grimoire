const { google } = require('googleapis');
const { getAuth } = require('./auth');

async function addToRegistry(item, sourceUrl, fileResult, sheetId) {
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  const tags = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');

  const row = [
    item.title,
    item.category,
    tags,
    item.type,
    item.summary,
    sourceUrl,
    new Date().toISOString().split('T')[0],
    fileResult.webViewLink || ''
  ];

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:H',
    valueInputOption: 'RAW',
    requestBody: { values: [row] }
  });
}

module.exports = { addToRegistry };
