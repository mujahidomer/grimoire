// keyTakeaways is now a free-form JSON value produced by Haiku: a string, an
// array of strings, or (typically) a nested object whose keys the model invents
// per item. Older items still hold a plain array of strings. These helpers
// flatten any of those shapes into plain text (for embeddings + chat context)
// or nested markdown (for the raw-markdown / Drive output) without assuming a
// fixed schema.

function isEmptyTakeaways(value) {
  if (value == null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

// Flatten to a plain newline-delimited string. Object keys are surfaced as
// "Key: value" so the structure still carries meaning into search/chat.
function takeawaysToText(value) {
  const lines = [];

  const walk = (node, keyPrefix) => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') {
      const text = String(node).trim();
      if (text) lines.push(keyPrefix ? `${keyPrefix}: ${text}` : text);
      return;
    }
    if (Array.isArray(node)) {
      for (const el of node) walk(el, keyPrefix);
      return;
    }
    if (typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        const label = keyPrefix ? `${keyPrefix} — ${k}` : k;
        walk(v, label);
      }
    }
  };

  walk(value, '');
  return lines.join('\n');
}

// Flatten to a nested markdown bullet list. Object keys become bolded bullets
// with their values nested beneath.
function takeawaysToMarkdown(value, depth = 0) {
  const indent = '  '.repeat(depth);
  const lines = [];

  if (value == null) return '';

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const text = String(value).trim();
    return text ? `${indent}- ${text}` : '';
  }

  if (Array.isArray(value)) {
    for (const el of value) {
      const rendered = takeawaysToMarkdown(el, depth);
      if (rendered) lines.push(rendered);
    }
    return lines.join('\n');
  }

  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') {
        const text = String(v).trim();
        lines.push(`${indent}- **${k}:** ${text}`);
      } else if (!isEmptyTakeaways(v)) {
        lines.push(`${indent}- **${k}:**`);
        const nested = takeawaysToMarkdown(v, depth + 1);
        if (nested) lines.push(nested);
      } else {
        lines.push(`${indent}- **${k}:**`);
      }
    }
    return lines.join('\n');
  }

  return '';
}

module.exports = { isEmptyTakeaways, takeawaysToText, takeawaysToMarkdown };
