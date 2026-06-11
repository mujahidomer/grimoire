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

  const { content: newContent, replaced } = mergeLinkedResource(existingContent, url, section);

  const after = await drive.files.update({
    fileId,
    media: { mimeType: 'text/plain', body: newContent },
    fields: 'id, name, parents'
  });

  if (after.data.name !== before.data.name ||
      JSON.stringify(after.data.parents) !== JSON.stringify(before.data.parents)) {
    console.warn(`⚠️ files.update changed metadata for ${fileId}: name '${before.data.name}'→'${after.data.name}', parents ${before.data.parents}→${after.data.parents}`);
  }

  return { id: after.data.id, replaced };
}

// Dedupe key: ignore protocol, leading www., trailing slash, query and fragment;
// host is case-insensitive, path keeps its case.
function normalizeResourceUrl(url) {
  const raw = (url || '').trim();
  try {
    const u = new URL(raw);
    return u.hostname.toLowerCase().replace(/^www\./, '') + u.pathname.replace(/\/+$/, '');
  } catch {
    return raw
      .replace(/^https?:\/\//i, '')
      .replace(/^www\./i, '')
      .split(/[?#]/)[0]
      .replace(/\/+$/, '')
      .toLowerCase();
  }
}

// Splits content into the base document and its linked-resource sections.
// Matches both header formats: "## Linked Resource" (old) and "## Linked Resource: <title>".
function splitLinkedResourceSections(content) {
  const re = /\n---\n+(?=## Linked Resource(?::|\s*\n))/g;
  const starts = [];
  let m;
  while ((m = re.exec(content)) !== null) starts.push(m.index);
  if (starts.length === 0) return { base: content, sections: [] };

  const base = content.slice(0, starts[0]);
  const sections = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : content.length;
    const text = content.slice(start, end);
    const urlMatch = text.match(/^Source:\s*(\S+)/m);
    return { text, url: urlMatch ? urlMatch[1] : '' };
  });
  return { base, sections };
}

// Idempotent merge keyed on normalized Source URL: existing sections for the same
// URL are removed (all of them) and the fresh section appended in their place.
function mergeLinkedResource(existingContent, url, section) {
  const withFrontmatter = addLinkedResourceToFrontmatter(existingContent, url);
  const { base, sections } = splitLinkedResourceSections(withFrontmatter);

  const target = normalizeResourceUrl(url);
  const kept = sections.filter(s => normalizeResourceUrl(s.url) !== target);
  const replaced = kept.length < sections.length;

  return { content: base + kept.map(s => s.text).join('') + section, replaced };
}

function addLinkedResourceToFrontmatter(content, url) {
  if (!content.startsWith('---\n')) return content;
  const end = content.indexOf('\n---', 4);
  if (end === -1) return content;

  const frontmatter = content.slice(0, end);
  const rest = content.slice(end);
  const lines = frontmatter.split('\n');

  // Collect existing entries from either `linked_resources: []` or a block list
  const fieldIdx = lines.findIndex(l => /^linked_resources:/.test(l));
  const existing = [];
  let removeCount = 0;
  if (fieldIdx !== -1) {
    let i = fieldIdx + 1;
    while (i < lines.length && /^\s+- /.test(lines[i])) {
      existing.push(lines[i].replace(/^\s+- /, '').trim());
      i++;
    }
    removeCount = 1 + existing.length;
  }

  // Dedupe by normalized URL (keeping first occurrence), then add the new one
  const seen = new Set();
  const deduped = [];
  for (const u of [...existing, url]) {
    const key = normalizeResourceUrl(u);
    if (!u || seen.has(key)) continue;
    seen.add(key);
    deduped.push(u);
  }

  const fieldLines = ['linked_resources:', ...deduped.map(u => `  - ${u}`)];
  if (fieldIdx !== -1) {
    lines.splice(fieldIdx, removeCount, ...fieldLines);
  } else {
    lines.push(...fieldLines);
  }

  return lines.join('\n') + rest;
}

module.exports = { saveToGrimoire, appendLinkedResource, addLinkedResourceToFrontmatter, mergeLinkedResource };
