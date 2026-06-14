export function getYouTubeVideoId(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    const href = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    const u = new URL(href);
    const hostname = u.hostname.replace(/^www\./, "");

    if (hostname === "youtu.be") {
      return u.pathname.slice(1).split("/")[0] || null;
    }
    if (hostname === "youtube.com" || hostname.endsWith(".youtube.com")) {
      const fromQuery = u.searchParams.get("v");
      if (fromQuery) return fromQuery;
      const m = u.pathname.match(/\/(embed|shorts|live|v)\/([^/?]+)/);
      return m ? m[2] : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function getYouTubeThumbnail(url: string): string | null {
  const videoId = getYouTubeVideoId(url);
  if (!videoId) return null;
  return `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
}

export function isYouTubeImageUrl(url: string): boolean {
  return /^https?:\/\/(?:img\.youtube\.com|i\.ytimg\.com)\//i.test(url);
}
