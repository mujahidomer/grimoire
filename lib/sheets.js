const { google } = require('googleapis');
const { getAuth } = require('./auth');

function getSheetsClient() {
  const auth = getAuth();
  return google.sheets({ version: 'v4', auth });
}

async function addToRegistry(item, sourceUrl, fileResult, sheetId) {
  const sheets = getSheetsClient();

  const tags = Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');

  const row = [
    item.title,
    item.category,
    tags,
    item.type,
    item.summary,
    sourceUrl,
    new Date().toISOString().split('T')[0],
    fileResult.webViewLink || '',
    fileResult.id || '',
    '' // Confirmation Message ID — filled in after the confirmation is sent
  ];

  const res = await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:J',
    valueInputOption: 'RAW',
    requestBody: { values: [row] }
  });

  // updatedRange looks like 'Sheet1!A5:J5' — extract the row number
  const match = (res.data.updates?.updatedRange || '').match(/![A-Z]+(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

async function setConfirmationMessageId(sheetId, rowNumbers, messageId) {
  const rows = rowNumbers.filter(r => Number.isInteger(r));
  if (rows.length === 0) return;

  const sheets = getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: 'RAW',
      data: rows.map(r => ({
        range: `Sheet1!J${r}`,
        values: [[String(messageId)]]
      }))
    }
  });
}

async function getRegistryRows(sheetId) {
  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: 'Sheet1!A:J'
  });
  return res.data.values || [];
}

function rowToEntry(row, rowNumber) {
  return {
    title: row[0] || '',
    sourceUrl: row[5] || '',
    fileId: row[8] || '',
    rowNumber
  };
}

async function findEntryByMessageId(sheetId, messageId) {
  const rows = await getRegistryRows(sheetId);
  const target = String(messageId);
  for (let i = rows.length - 1; i >= 1; i--) {
    if ((rows[i][9] || '') === target && rows[i][8]) {
      return rowToEntry(rows[i], i + 1);
    }
  }
  return null;
}

function normalizeUrl(url) {
  return (url || '').trim().replace(/\/+$/, '');
}

async function findEntryBySourceUrl(sheetId, url) {
  const rows = await getRegistryRows(sheetId);
  const target = normalizeUrl(url);
  if (!target) return null;
  for (let i = rows.length - 1; i >= 1; i--) {
    if (normalizeUrl(rows[i][5]) === target && rows[i][8]) {
      return rowToEntry(rows[i], i + 1);
    }
  }
  return null;
}

module.exports = { addToRegistry, setConfirmationMessageId, findEntryByMessageId, findEntryBySourceUrl };
