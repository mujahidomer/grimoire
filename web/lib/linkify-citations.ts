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

  // Preferred format: [[N|Title]]
  text = text.replace(/\[\[(\d+)\|([^\]]+)\]\]/g, (_, n, title) =>
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
