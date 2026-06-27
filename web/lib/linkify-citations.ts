import type { ChatSource } from "@/lib/types";

function citationMarkdown(
  n: number,
  title: string,
  sources: ChatSource[],
): string {
  const source = sources[n - 1];
  const label = title.trim();
  if (!source) return `[${label}](#cite-${n})`;
  return `[${label}](/item/${source.id})`;
}

function parseLegacyPart(part: string, sources: ChatSource[]): string {
  const m = part.match(/^\[(\d+)\]\s*(.*)$/);
  if (!m) return part;
  const n = parseInt(m[1], 10);
  const title = (m[2] || sources[n - 1]?.title || `Source ${n}`).trim();
  return citationMarkdown(n, title, sources);
}

// Converts model citation markers into markdown links to saved library items.
export function linkifyCitations(
  content: string,
  sources: ChatSource[],
): string {
  if (!content) return content;

  let text = content;

  // Preferred format: [[s3|Title]] — short handle the model copies verbatim.
  // Legacy chats used [[3|Title]] (bare number); the optional `s` covers both.
  // Either way the digits index positionally into `sources` (1-based).
  text = text.replace(/\[\[s?(\d+)\|([^\]]+)\]\]/g, (_, n, title) =>
    citationMarkdown(parseInt(n, 10), title, sources),
  );

  // Legacy: ([1] Title, [3] Other Title)
  text = text.replace(/\(\s*(\[\d+\][^)]*)\)/g, (match, inner) => {
    const parts = inner.split(/,\s*(?=\[\d+\])/).filter(Boolean);
    if (parts.length === 0) return match;
    return parts.map((p: string) => parseLegacyPart(p.trim(), sources)).join(" ");
  });

  // Legacy mid-sentence: item [N] (Title)
  text = text.replace(/\bitem\s+\[(\d+)\]\s*\(([^)]+)\)/gi, (_, n, title) =>
    citationMarkdown(parseInt(n, 10), title, sources),
  );

  // Legacy: [N] (Title)
  text = text.replace(/\[(\d+)\]\s*\(([^)]+)\)/g, (_, n, title) =>
    citationMarkdown(parseInt(n, 10), title, sources),
  );

  return text;
}

// True when the answer renders at least one inline citation chip — either the
// model's [Title](cite:id) form or a marker that linkifyCitations resolves to a
// /item/ link. Used to hide the bottom Sources list when inline chips exist.
export function hasInlineCitations(
  content: string,
  sources: ChatSource[],
): boolean {
  if (!content) return false;
  if (/\]\(cite:/.test(content)) return true;
  return /\]\(\/item\//.test(linkifyCitations(content, sources));
}
