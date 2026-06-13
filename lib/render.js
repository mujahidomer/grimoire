const yaml = require('js-yaml');

// renderItemAsMarkdown(item) — regenerate the exact MD file format from the
// structured columns that are now the source of truth (Doc A item 6). Used for
// export, "view raw", and feeding an item to an LLM. The format matches the
// generator that previously wrote to Drive (front-matter + Summary / Key
// Takeaways / Transcript / Caption? / stacked Linked Resource blocks).
//
// Expected `item` shape (as returned by repository.getItemById):
//   { title, category, type, source_url, date_saved, summary, key_takeaways[],
//     transcript, caption, artifact_type, artifact_name, artifact_url,
//     artifact_url_source,
//     tags: [{ name, confidence_pending }] | [string],
//     linked_resources: [{ title, type, source_url, added_date, body_content }] }

// A pending ('?') tag renders with its trailing marker, exactly as the legacy
// files stored it. Accepts either {name, confidence_pending} or a plain string.
function tagToString(tag) {
  if (typeof tag === 'string') return tag.trim();
  if (!tag || typeof tag.name !== 'string') return '';
  const name = tag.name.trim();
  return tag.confidence_pending ? `${name}?` : name;
}

function buildFrontMatterObject(item) {
  const tags = (Array.isArray(item.tags) ? item.tags : [])
    .map(tagToString)
    .filter(Boolean);

  const artifactType = item.artifact_type || 'none';
  const artifactUrl = artifactType !== 'none' ? (item.artifact_url || null) : null;

  const linkedResources = (Array.isArray(item.linked_resources) ? item.linked_resources : [])
    .map(r => r.source_url)
    .filter(Boolean);

  return {
    title: item.title || '',
    category: item.category || '',
    type: item.type || '',
    tags,
    date_saved: item.date_saved || new Date().toISOString().split('T')[0],
    source_url: item.source_url || '',
    artifact_type: artifactType,
    artifact_name: artifactType !== 'none' ? (item.artifact_name || null) : null,
    artifact_url: artifactUrl,
    artifact_url_source: artifactUrl ? (item.artifact_url_source || null) : null,
    linked_resources: linkedResources
  };
}

function buildBody(item) {
  const sections = [];

  sections.push(`## Summary\n${(item.summary || '').trim() || '_No summary available._'}`);

  const takeaways = Array.isArray(item.key_takeaways) && item.key_takeaways.length > 0
    ? item.key_takeaways.map(t => `- ${t}`).join('\n')
    : '_No key takeaways._';
  sections.push(`## Key Takeaways\n${takeaways}`);

  const transcript = (item.transcript || '').trim();
  sections.push(`## Transcript\n${transcript || '_No transcript available._'}`);

  const caption = (item.caption || '').trim();
  if (caption) sections.push(`## Caption\n${caption}`);

  return sections.join('\n\n');
}

// Each linked resource renders as its own stacked block, matching the format the
// append path used to write to Drive.
function buildLinkedResourceBlocks(item) {
  const resources = Array.isArray(item.linked_resources) ? item.linked_resources : [];
  return resources.map(r => {
    const title = r.title || 'Linked Resource';
    const type = r.type || 'resource';
    const date = r.added_date || '';
    const body = (r.body_content || '').trim() || '_Content could not be extracted._';
    return `\n---\n\n## Linked Resource: ${title}\nType: ${type}\nSource: ${r.source_url || ''}\nAdded: ${date}\n\n${body}\n`;
  }).join('');
}

function renderItemAsMarkdown(item) {
  const frontMatter = yaml
    .dump(buildFrontMatterObject(item), { lineWidth: -1, noRefs: true })
    .trimEnd();
  const body = buildBody(item);
  const linked = buildLinkedResourceBlocks(item);
  return `---\n${frontMatter}\n---\n\n${body}\n${linked}`;
}

module.exports = { renderItemAsMarkdown };
