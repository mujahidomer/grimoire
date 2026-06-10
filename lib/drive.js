const { google } = require('googleapis');
const { getAuth } = require('./auth');

async function saveToGrimoire(item, grimoire) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const content = generateFileContent(item);
  const folderId = getFolderForCategory(item.category, grimoire.folderIds);

  const existing = await drive.files.list({
    q: `name='${item.fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, webViewLink)'
  });

  if (existing.data.files.length > 0) {
    const fileId = existing.data.files[0].id;
    await drive.files.update({
      fileId,
      media: { mimeType: 'text/plain', body: content },
      fields: 'id, webViewLink'
    });
    return { id: fileId, webViewLink: existing.data.files[0].webViewLink, updated: true };
  }

  const file = await drive.files.create({
    requestBody: {
      name: item.fileName,
      parents: [folderId],
      mimeType: 'text/plain'
    },
    media: { mimeType: 'text/plain', body: content },
    fields: 'id, webViewLink'
  });

  return { id: file.data.id, webViewLink: file.data.webViewLink, updated: false };
}

function getFolderForCategory(category, folderIds) {
  return folderIds[(category || 'Other').toLowerCase()] || folderIds['other'];
}

function generateFileContent(item) {
  const tags = Array.isArray(item.hashtags) && item.hashtags.length > 0
    ? item.hashtags.join(', ')
    : Array.isArray(item.tags) ? item.tags.join(', ') : (item.tags || '');
  const takeaways = Array.isArray(item.keyTakeaways)
    ? item.keyTakeaways.map(t => `- ${t}`).join('\n')
    : '';

  return `---
title: ${item.title}
category: ${item.category}
type: ${item.type}
tags: ${tags}
date_saved: ${new Date().toISOString().split('T')[0]}
---

## Summary
${item.summary}

## Key Takeaways
${takeaways}

---

## Full Transcript
${item.transcript || '_No transcript available._'}
`;
}

module.exports = { saveToGrimoire };
