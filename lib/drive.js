const { google } = require('googleapis');
const yaml = require('js-yaml');
const { getAuth } = require('./auth');
const { takeawaysToMarkdown, isEmptyTakeaways } = require('./takeaways');
const { pickPrimaryArtifactLink } = require('./url');

// Strip markdown link wrapping — "[text](url)" → "url" — trim, and drop any
// query string (session tokens / tracking params like ?igsh=, ?utm_source=,
// ?mcp_token= expire or are junk). Plain strings pass through. Returns null for
// empty/missing values.
function cleanUrl(value) {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const linked = s.match(/^\[[^\]]*\]\(([^)]+)\)$/);
  const url = (linked ? linked[1] : s).trim();
  return stripQuery(url) || null;
}

// Remove the query string (everything from "?" on). Exception: Google Docs/Drive
// links, which sometimes need their parameters to resolve, are left untouched.
function stripQuery(url) {
  if (!url) return url;
  let host = '';
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    // Not a parseable absolute URL — fall through to a plain split.
  }
  if (host === 'docs.google.com' || host === 'drive.google.com') return url;
  return url.split('?')[0];
}

// primaryLinkRank / pickPrimaryArtifactLink now live in ./url (the single
// URL path for the backend) so the Drive write path, the Postgres write path,
// and the backfill script all share one ranking.

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

// Build the YAML front-matter object. Serialized with js-yaml so any value
// (e.g. a title containing a colon) is quoted/escaped correctly. URLs are stored
// as plain strings; source_url is a single string; linked_resources is a flat
// array of plain URL strings.
function buildFrontMatterObject(item) {
  // Normalized tags (may carry a trailing '?' low-confidence marker) take
  // precedence so the frontmatter reflects the canonical/flagged set; hashtags
  // are the fallback. Emitted as a flat array → js-yaml renders a clean block
  // list. The '?' marker is part of the tag string and is preserved verbatim.
  const tags = Array.isArray(item.tags) && item.tags.length > 0
    ? item.tags.map(t => String(t).trim()).filter(Boolean)
    : Array.isArray(item.hashtags) && item.hashtags.length > 0
      ? item.hashtags.map(t => String(t).trim()).filter(Boolean)
      : (typeof item.tags === 'string'
          ? item.tags.split(',').map(t => t.trim()).filter(Boolean)
          : []);

  const artifactType = item.artifact_type || 'none';
  let artifactUrl = artifactType !== 'none' ? cleanUrl(item.artifact_url) : null;
  let artifactUrlSource = artifactUrl ? (item.artifact_url_source || null) : null;

  // Flat, deduped list of plain URL strings; never the artifact_url itself.
  const linked = (Array.isArray(item.linked_resources) ? item.linked_resources : [])
    .map(cleanUrl)
    .filter(Boolean);
  let linkedResources = [...new Set(linked)].filter(u => u !== artifactUrl);

  // When the artifact has a type but no explicit link, promote the most likely
  // primary link from linked_resources into artifact_url (and drop it from the
  // list so it isn't duplicated). Leaves null if no clear primary exists.
  if (artifactType !== 'none' && !artifactUrl) {
    const primary = pickPrimaryArtifactLink(linkedResources);
    if (primary) {
      artifactUrl = primary;
      artifactUrlSource = 'linked resource';
      linkedResources = linkedResources.filter(u => u !== primary);
    }
  }

  return {
    title: item.title || '',
    category: item.category || '',
    type: item.type || '',
    tags,
    date_saved: new Date().toISOString().split('T')[0],
    source_url: cleanUrl(item.sourceUrl) || '',
    artifact_type: artifactType,
    artifact_name: artifactType !== 'none' ? (item.artifact_name || null) : null,
    artifact_url: artifactUrl,
    artifact_url_source: artifactUrl ? artifactUrlSource : null,
    linked_resources: linkedResources
  };
}

// Build the body with each kind of content under its own labeled section.
function buildBody(item) {
  const sections = [];

  sections.push(`## Summary\n${(item.summary || '').trim() || '_No summary available._'}`);

  const takeaways = !isEmptyTakeaways(item.keyTakeaways)
    ? takeawaysToMarkdown(item.keyTakeaways)
    : '_No key takeaways._';
  sections.push(`## Key Takeaways\n${takeaways}`);

  const transcript = (item.transcript || '').trim();
  sections.push(`## Transcript\n${transcript || '_No transcript available._'}`);

  // Caption and hashtags are meta/reel-specific; only emit them when present.
  const caption = (item.caption || '').trim();
  if (caption) sections.push(`## Caption\n${caption}`);

  const hashtags = (Array.isArray(item.hashtags) ? item.hashtags : []).filter(Boolean);
  if (hashtags.length > 0) {
    const list = hashtags.map(h => `- ${String(h).startsWith('#') ? h : `#${h}`}`).join('\n');
    sections.push(`## Hashtags\n${list}`);
  }

  return sections.join('\n\n');
}

function generateFileContent(item) {
  const frontMatter = yaml.dump(buildFrontMatterObject(item), { lineWidth: -1, noRefs: true }).trimEnd();
  const body = buildBody(item);
  return `---\n${frontMatter}\n---\n\n${body}\n`;
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

// Replace a flagged tag (e.g. "language-model?") with a canonical tag in the
// frontmatter `tags:` block list. Dedupes, and reports which '?' tags remain so
// callers can decide whether the file still needs review.
//
// A trailing '?' is an intentional low-confidence marker, NOT junk: it is matched
// and preserved per list item, never stripped.
function replaceTagInContent(content, flaggedTag, canonicalTag) {
  if (!content.startsWith('---\n')) return { content, remainingFlagged: [], changed: false };
  const end = content.indexOf('\n---', 4);
  if (end === -1) return { content, remainingFlagged: [], changed: false };

  const frontmatter = content.slice(0, end);
  const rest = content.slice(end);
  const lines = frontmatter.split('\n');

  const idx = lines.findIndex(l => /^tags:/.test(l));
  if (idx === -1) return { content, remainingFlagged: [], changed: false };

  // Read current tags. Primary format is a YAML block list:
  //   tags:
  //     - a
  //     - b?
  // Legacy files may still use an inline scalar (`tags: a, b`) or flow list
  // (`tags: [a, b]`) — tolerate both so older notes still resolve.
  const unquote = (s) => s.trim().replace(/^['"]|['"]$/g, '');
  const inline = lines[idx].replace(/^tags:\s*/, '').trim();

  let current = [];
  let blockCount = 0; // # of "- item" lines following the tags: line (block form)
  if (inline) {
    current = inline.replace(/^\[|\]$/g, '').split(',').map(unquote).filter(Boolean);
  } else {
    for (let i = idx + 1; i < lines.length && /^\s+-\s+/.test(lines[i]); i++) {
      current.push(unquote(lines[i].replace(/^\s+-\s+/, '')));
      blockCount++;
    }
  }

  const out = [];
  let changed = false;
  for (const tag of current) {
    const replacement = tag === flaggedTag ? canonicalTag : tag;
    if (tag === flaggedTag) changed = true;
    if (!out.includes(replacement)) out.push(replacement);
  }

  // Re-serialize the tags block via js-yaml so '?' (and any other special chars)
  // are quoted exactly as the generator would, then splice it back in place.
  const fieldLines = yaml.dump({ tags: out }, { lineWidth: -1, noRefs: true }).trimEnd().split('\n');
  lines.splice(idx, 1 + blockCount, ...fieldLines);

  const remainingFlagged = out.filter(t => t.endsWith('?'));
  return { content: lines.join('\n') + rest, remainingFlagged, changed };
}

// Download the file, swap the flagged tag for the canonical one, re-upload.
async function resolveTagInFile(fileId, flaggedTag, canonicalTag) {
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const current = await drive.files.get({ fileId, alt: 'media' });
  const existing = typeof current.data === 'string' ? current.data : String(current.data);

  const { content, remainingFlagged, changed } = replaceTagInContent(existing, flaggedTag, canonicalTag);

  if (changed) {
    await drive.files.update({
      fileId,
      media: { mimeType: 'text/plain', body: content },
      fields: 'id'
    });
  }

  return { changed, remainingFlagged };
}

module.exports = { saveToGrimoire, appendLinkedResource, addLinkedResourceToFrontmatter, mergeLinkedResource, replaceTagInContent, resolveTagInFile, generateFileContent };
