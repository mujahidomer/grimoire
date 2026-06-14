import { fetchLinkPreview } from "@/lib/api";
import { getYouTubeThumbnail } from "@/lib/youtube";
import type { LinkPreview } from "@/lib/types";

const STORAGE_KEY = "grimoire-thumbnail-cache";

type CacheEntry = {
  preview: LinkPreview;
  image: string | null;
};

const memory = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<CacheEntry>>();

function cacheKey(url: string): string {
  return url.trim();
}

function readStorage(): Record<string, string | null> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "{}") as Record<
      string,
      string | null
    >;
  } catch {
    return {};
  }
}

function writeStorage(key: string, image: string | null) {
  if (typeof window === "undefined") return;
  try {
    const data = readStorage();
    data[key] = image;
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* sessionStorage full or unavailable */
  }
}

function remember(key: string, preview: LinkPreview, image: string | null) {
  const entry = { preview, image };
  memory.set(key, entry);
  writeStorage(key, image);
  return entry;
}

function youtubePreview(url: string, image: string): LinkPreview {
  return {
    url,
    title: null,
    description: null,
    image,
    site_name: "YouTube",
  };
}

/** Returns a cached image URL, `null` if cached as missing, or `undefined` if not cached yet. */
export function getCachedThumbnail(url: string): string | null | undefined {
  const key = cacheKey(url);
  const direct = getYouTubeThumbnail(url);
  if (direct) return direct;

  const mem = memory.get(key);
  if (mem) return mem.image;

  if (typeof window !== "undefined" && key in readStorage()) {
    const image = readStorage()[key];
    remember(key, { url, title: null, description: null, image, site_name: null }, image);
    return image;
  }

  return undefined;
}

export function getCachedLinkPreview(url: string): LinkPreview | undefined {
  const key = cacheKey(url);
  const direct = getYouTubeThumbnail(url);
  if (direct) return youtubePreview(url, direct);
  return memory.get(key)?.preview;
}

export async function loadLinkPreview(url: string): Promise<LinkPreview> {
  const key = cacheKey(url);
  const direct = getYouTubeThumbnail(url);
  if (direct) {
    const preview = youtubePreview(url, direct);
    remember(key, preview, direct);
    return preview;
  }

  const cached = memory.get(key);
  if (cached) return cached.preview;

  const pending = inflight.get(key);
  if (pending) return (await pending).preview;

  const promise = fetchLinkPreview(url)
    .then((preview) => remember(key, preview, preview.image))
    .catch((err) => {
      inflight.delete(key);
      throw err;
    });

  inflight.set(key, promise);
  return (await promise).preview;
}

export async function loadThumbnail(url: string): Promise<string | null> {
  const preview = await loadLinkPreview(url);
  return preview.image;
}
