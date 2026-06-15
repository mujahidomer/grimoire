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

// Parse nested markdown bullets (output of takeawaysToMarkdown) back into the
// free-form JSON value the UI and classifier expect.
function markdownToTakeaways(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return [];
  if (!/^(\s*)- /m.test(trimmed)) return trimmed;

  const nodes = [];
  for (const line of trimmed.split('\n')) {
    const m = line.match(/^(\s*)- (.+)$/);
    if (!m) continue;

    const depth = m[1].length / 2;
    const content = m[2].trim();
    let key = null;
    let value = null;

    const kvInline = content.match(/^\*\*([^*]+):\*\*\s+(.+)$/);
    const kvOnly = content.match(/^\*\*([^*]+):\*\*$/);
    if (kvInline) {
      key = kvInline[1].trim();
      value = kvInline[2].trim();
    } else if (kvOnly) {
      key = kvOnly[1].trim();
    } else {
      value = content;
    }

    nodes.push({ depth, key, value, children: [] });
  }

  if (nodes.length === 0) return trimmed;

  const root = { depth: -1, children: [] };
  const stack = [root];
  for (const node of nodes) {
    while (stack.length > 1 && stack[stack.length - 1].depth >= node.depth) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  }

  const value = childrenToTakeawayValue(root.children);
  return value == null ? [] : value;
}

function childrenToTakeawayValue(children) {
  if (!children || children.length === 0) return null;

  const allKeyed = children.every((c) => c.key);
  const noneKeyed = children.every((c) => !c.key);

  if (noneKeyed) {
    return children.map((c) => {
      if (c.children.length > 0) return childrenToTakeawayValue(c.children);
      return c.value;
    });
  }

  if (allKeyed) {
    const obj = {};
    for (const c of children) {
      if (c.children.length > 0) {
        obj[c.key] = childrenToTakeawayValue(c.children);
      } else {
        obj[c.key] = c.value ?? '';
      }
    }
    return obj;
  }

  return children.map((c) => {
    if (c.key) {
      if (c.children.length > 0) return { [c.key]: childrenToTakeawayValue(c.children) };
      return { [c.key]: c.value ?? '' };
    }
    return c.value;
  });
}

module.exports = {
  isEmptyTakeaways,
  takeawaysToText,
  takeawaysToMarkdown,
  markdownToTakeaways,
};
