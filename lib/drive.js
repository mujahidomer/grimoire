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
source_url: ${item.sourceUrl || ''}
linked_resources: []
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

// Drive has no append: download the file, splice the new section in, re-upload.
// `processed` is the cleaned { resource_type, title, content } from the classifier.
async function appendLinkedResource(fileId, url, processed) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const before = await drive.files.get({ fileId, fields: 'name, parents' });

  const current = await drive.files.get({ fileId, alt: 'media' });
  const existingContent = typeof current.data === 'string' ? current.data : String(current.data);

  const date = new Date().toISOString().split('T')[0];
  const title = processed?.title || 'Linked Resource';
  const resourceType = processed?.resource_type || 'resource';
  const body = processed?.content?.trim() || '_Content could not be extracted._';
  const section = `\n---\n\n## Linked Resource: ${title}\nType: ${resourceType}\nSource: ${url}\nAdded: ${date}\n\n${body}\n`;

  const newContent = addLinkedResourceToFrontmatter(existingContent, url) + section;

  const after = await drive.files.update({
    fileId,
    media: { mimeType: 'text/plain', body: newContent },
    fields: 'id, name, parents'
  });

  if (after.data.name !== before.data.name ||
      JSON.stringify(after.data.parents) !== JSON.stringify(before.data.parents)) {
    console.warn(`⚠️ files.update changed metadata for ${fileId}: name '${before.data.name}'→'${after.data.name}', parents ${before.data.parents}→${after.data.parents}`);
  }

  return { id: after.data.id };
}

function addLinkedResourceToFrontmatter(content, url) {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return content;

  let frontmatter = content.slice(0, end);
  const rest = content.slice(end);

  if (/^linked_resources:\s*\[\s*\]\s*$/m.test(frontmatter)) {
    frontmatter = frontmatter.replace(/^linked_resources:\s*\[\s*\]\s*$/m, `linked_resources:\n  - ${url}`);
  } else if (/^linked_resources:\s*$/m.test(frontmatter)) {
    // Existing block list: append after its last "  - " entry
    const lines = frontmatter.split('\n');
    const fieldIdx = lines.findIndex(l => /^linked_resources:\s*$/.test(l));
    let insertAt = fieldIdx + 1;
    while (insertAt < lines.length && /^\s+- /.test(lines[insertAt])) insertAt++;
    lines.splice(insertAt, 0, `  - ${url}`);
    frontmatter = lines.join('\n');
  } else {
    // Older files without the field
    frontmatter += `\nlinked_resources:\n  - ${url}`;
  }

  return frontmatter + rest;
}

module.exports = { saveToGrimoire, appendLinkedResource, addLinkedResourceToFrontmatter };
