const { google } = require('googleapis');
const { getAuth } = require('./auth');
const { Readable } = require('stream');

async function saveToGrimoire(item, grimoire) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const content = generateFileContent(item);
  const folderId = getFolderForType(item.type, grimoire.folderIds);

  // Check if file already exists (avoid duplicates)
  const existing = await drive.files.list({
    q: `name='${item.fileName}' and '${folderId}' in parents and trashed=false`,
    fields: 'files(id, webViewLink)'
  });

  if (existing.data.files.length > 0) {
    const fileId = existing.data.files[0].id;
    // Update existing file content
    await drive.files.update({
      fileId,
      media: {
        mimeType: 'text/plain',
        body: content
      },
      fields: 'id, webViewLink'
    });
    return { id: fileId, webViewLink: existing.data.files[0].webViewLink, updated: true };
  }

  // Create new file
  const file = await drive.files.create({
    requestBody: {
      name: item.fileName,
      parents: [folderId],
      mimeType: 'text/plain'
    },
    media: {
      mimeType: 'text/plain',
      body: content
    },
    fields: 'id, webViewLink'
  });

  return { id: file.data.id, webViewLink: file.data.webViewLink, updated: false };
}

function getFolderForType(type, folderIds) {
  const map = {
    skill: folderIds.skills,
    markdown: folderIds.markdown,
    agent: folderIds.agents,
    insight: folderIds.insights
  };
  return map[type] || folderIds.insights;
}

function generateFileContent(item) {
  return `---
type: ${item.type}
category: ${item.category}
skill_name: ${item.skillName}
date_saved: ${new Date().toISOString().split('T')[0]}
---

## What it does
${item.description}

## When to use it
${item.whenToUse}

## How to apply it
${item.howToApply}

## Example
${item.example}
`;
}

module.exports = { saveToGrimoire };
