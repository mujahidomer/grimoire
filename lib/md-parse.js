const yaml = require('js-yaml');
const { markdownToTakeaways, isEmptyTakeaways } = require('./takeaways');

// Parse an existing Grimoire MD file (front-matter + body sections + stacked
// "## Linked Resource" blocks) back into a structured object, for the one-time
// Drive → Postgres migration (Doc A item 4). This is the inverse of render.js.
//
// Returns:
//   {
//     frontMatter: { title, category, type, tags[], date_saved, source_url,
//                    artifact_type, artifact_name, artifact_url,
//                    artifact_url_source, linked_resources[] },
//     summary, transcript, caption,
//     keyTakeaways: string | object | array (structured value for jsonb),
//     hashtags: string[],
//     linkedResources: [{ title, type, source_url, added_date, body_content }]
//   }
//
// '?' tag markers are preserved on the tag strings; the migration translates
// them into item_tags.confidence_pending.

// Split the document into base content (front-matter + body) and the stacked
// linked-resource sections. Matches both "## Linked Resource" (old) and
// "## Linked Resource: <title>" header formats.
function splitLinkedResourceSections(content) {
  const re = /\n---\n+(?=## Linked Resource(?::|\s*\n))/g;
  const starts = [];
  let m;
  while ((m = re.exec(content)) !== null) starts.push(m.index);
  if (starts.length === 0) return { base: content, sections: [] };

  const base = content.slice(0, starts[0]);
  const sections = starts.map((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : content.length;
    return content.slice(start, end);
  });
  return { base, sections };
}

function parseLinkedResourceSection(text) {
  const titleMatch = text.match(/^##\s+Linked Resource(?::\s*(.*))?$/m);
  const typeMatch = text.match(/^Type:\s*(.*)$/m);
  const sourceMatch = text.match(/^Source:\s*(\S+)/m);
  const addedMatch = text.match(/^Added:\s*(\S+)/m);

  // body = everything after the Added: line (or after the header block).
  let body = '';
  const anchor = addedMatch
    ? text.indexOf(addedMatch[0]) + addedMatch[0].length
    : (sourceMatch ? text.indexOf(sourceMatch[0]) + sourceMatch[0].length : 0);
  if (anchor) body = text.slice(anchor).trim();

  return {
    title: (titleMatch && titleMatch[1] ? titleMatch[1] : 'Linked Resource').trim(),
    type: (typeMatch ? typeMatch[1] : 'resource').trim() || 'resource',
    source_url: sourceMatch ? sourceMatch[1].trim() : '',
    added_date: addedMatch ? addedMatch[1].trim() : null,
    body_content: body
  };
}

// Pull a "## Heading" section's body out of the base document. No 'm' flag: the
// trailing `$` must mean end-of-string, and the heading boundary is matched
// explicitly via (?:^|\n) so it still anchors at a line start.
function extractSection(body, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(?:^|\\n)##\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`);
  const m = body.match(re);
  if (!m) return '';
  return m[1].trim();
}

function isPlaceholder(text) {
  return /^_.*_$/.test((text || '').trim());
}

// Coerce a front-matter tags value into a clean string array. Handles an array
// (block/flow list), an inline comma-separated scalar, a single bare tag, or
// null/undefined.
function coerceTags(value) {
  if (Array.isArray(value)) {
    return value.map(t => String(t).trim()).filter(Boolean);
  }
  if (typeof value === 'string') {
    return value.split(',').map(t => t.trim()).filter(Boolean);
  }
  return [];
}

function parseMarkdown(content) {
  const raw = String(content || '');
  const { base, sections } = splitLinkedResourceSections(raw);

  // Front-matter: between the first "---" and the next "---".
  let frontMatter = {};
  let body = base;
  const fmMatch = base.match(/^---\n([\s\S]*?)\n---\n?/);
  if (fmMatch) {
    try {
      frontMatter = yaml.load(fmMatch[1]) || {};
    } catch {
      frontMatter = {};
    }
    body = base.slice(fmMatch[0].length);
  }
  // Normalize tags to an array of strings regardless of how the file stored them.
  // Legacy files use an inline comma-separated scalar (`tags: a, b, c`) which YAML
  // parses as one string; newer files use a YAML block/flow list (already an array).
  // '?' low-confidence markers are preserved verbatim.
  frontMatter.tags = coerceTags(frontMatter.tags);

  const summaryRaw = extractSection(body, 'Summary');
  const transcriptRaw = extractSection(body, 'Transcript');
  const captionRaw = extractSection(body, 'Caption');
  const takeawaysRaw = extractSection(body, 'Key Takeaways');
  const hashtagsRaw = extractSection(body, 'Hashtags');

  const keyTakeaways = takeawaysRaw && !isPlaceholder(takeawaysRaw)
    ? markdownToTakeaways(takeawaysRaw)
    : [];
  const normalizedTakeaways = isEmptyTakeaways(keyTakeaways) ? [] : keyTakeaways;

  const hashtags = hashtagsRaw && !isPlaceholder(hashtagsRaw)
    ? hashtagsRaw.split('\n')
        .map(l => l.replace(/^[-*]\s+/, '').replace(/^#/, '').trim())
        .filter(Boolean)
    : [];

  return {
    frontMatter,
    summary: isPlaceholder(summaryRaw) ? '' : summaryRaw,
    transcript: isPlaceholder(transcriptRaw) ? '' : transcriptRaw,
    caption: isPlaceholder(captionRaw) ? '' : captionRaw,
    keyTakeaways: normalizedTakeaways,
    hashtags,
    linkedResources: sections.map(parseLinkedResourceSection).filter(r => r.source_url)
  };
}

module.exports = { parseMarkdown };
