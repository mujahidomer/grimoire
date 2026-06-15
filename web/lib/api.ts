import type {
  ChatResponse,
  Item,
  LinkedResource,
  LinkPreview,
  SaveResponse,
} from "./types";
import { createClient as createBrowserClient } from "./supabase/client";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// Legacy dev fallback when Supabase auth is not configured.
const LEGACY_USER_ID = process.env.NEXT_PUBLIC_GRIMOIRE_USER_ID ?? "";

async function clientAuthHeaders(): Promise<HeadersInit> {
  const h: Record<string, string> = { "Content-Type": "application/json" };

  try {
    const supabase = createBrowserClient();
    // Validate the session with Supabase before attaching the token — getSession()
    // alone can return a stale local copy while cookies are still syncing.
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        h.Authorization = `Bearer ${session.access_token}`;
        return h;
      }
    }
  } catch {
    /* browser client unavailable (SSR) */
  }

  if (LEGACY_USER_ID) h["x-user-id"] = LEGACY_USER_ID;
  return h;
}

function serverAuthHeaders(accessToken: string | null | undefined): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (accessToken) {
    h.Authorization = `Bearer ${accessToken}`;
  } else if (LEGACY_USER_ID) {
    h["x-user-id"] = LEGACY_USER_ID;
  }
  return h;
}

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.error || body.message || detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export interface ItemsQuery {
  q?: string;
  category?: string;
  tag?: string;
}

export async function fetchItems(
  query: ItemsQuery = {},
  accessToken?: string | null,
): Promise<Item[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.tag) params.set("tag", query.tag);
  const qs = params.toString();
  const headers =
    accessToken !== undefined
      ? serverAuthHeaders(accessToken)
      : await clientAuthHeaders();
  const res = await fetch(`${BASE}/api/items${qs ? `?${qs}` : ""}`, {
    headers,
    cache: "no-store",
  });
  const data = await json<{ count: number; items: Item[] }>(res);
  return data.items;
}

export function previewImageUrl(imageUrl: string): string {
  if (/^https?:\/\/(?:img\.youtube\.com|i\.ytimg\.com)\//i.test(imageUrl)) {
    return imageUrl;
  }
  const params = new URLSearchParams({ url: imageUrl });
  return `${BASE}/api/link-preview/image?${params}`;
}

export async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  const params = new URLSearchParams({ url });
  const res = await fetch(`${BASE}/api/link-preview?${params}`, {
    cache: "no-store",
  });
  const data = await json<{ preview: LinkPreview }>(res);
  return data.preview;
}

export async function fetchItem(
  id: string,
  accessToken?: string | null,
): Promise<Item> {
  const headers =
    accessToken !== undefined
      ? serverAuthHeaders(accessToken)
      : await clientAuthHeaders();
  const res = await fetch(`${BASE}/api/items/${id}`, {
    headers,
    cache: "no-store",
  });
  const data = await json<{ item: Item }>(res);
  return data.item;
}

export async function fetchItemMarkdown(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/items/${id}?format=markdown`, {
    headers: await clientAuthHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load markdown (${res.status})`);
  return res.text();
}

export async function askChat(question: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({ question }),
  });
  return json<ChatResponse>(res);
}

export async function saveUrl(
  url: string,
  opts: { keepalive?: boolean } = {},
): Promise<SaveResponse> {
  const res = await fetch(`${BASE}/api/save`, {
    method: "POST",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({ url }),
    // keepalive lets the request finish even if the tab is backgrounded or
    // closed (e.g. the iOS share sheet bouncing back to the source app).
    keepalive: opts.keepalive,
  });
  const data = (await res.json().catch(() => ({}))) as SaveResponse;
  if (!res.ok || !data.success) {
    throw new Error(data.message || data.error || "Couldn't save that link.");
  }
  return data;
}

// Public Supabase Storage bucket that uploaded PDFs/images land in. The backend
// detects these object URLs and routes them to the PDF / image pipelines.
const UPLOAD_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_UPLOAD_BUCKET ?? "uploads";

// Upload a file straight to Supabase Storage (bytes never touch Railway) and
// return its public URL. The Supabase client sends the raw file with the right
// multipart content-type itself — we deliberately do not attach our JSON auth
// headers here.
export async function uploadFile(file: File): Promise<string> {
  const supabase = createBrowserClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "";
  const safeExt = ext ? `.${ext.toLowerCase()}` : "";
  const prefix = user?.id ? `${user.id}/` : "";
  const path = `${prefix}${Date.now()}-${crypto.randomUUID()}${safeExt}`;

  const { error } = await supabase.storage
    .from(UPLOAD_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || undefined,
    });
  if (error) {
    throw new Error(error.message || "Upload failed.");
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from(UPLOAD_BUCKET).getPublicUrl(path);
  if (!publicUrl) throw new Error("Couldn't resolve the uploaded file URL.");

  return publicUrl;
}

export async function deleteItem(id: string): Promise<void> {
  const res = await fetch(`${BASE}/api/items/${id}`, {
    method: "DELETE",
    headers: await clientAuthHeaders(),
  });
  await json<{ success: boolean }>(res);
}

export async function addLinkedResource(
  itemId: string,
  url: string,
): Promise<LinkedResource[]> {
  const res = await fetch(`${BASE}/api/items/${itemId}/linked-resources`, {
    method: "POST",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({ url }),
  });
  const data = await json<{ success: boolean; linked_resources: LinkedResource[] }>(
    res,
  );
  return data.linked_resources;
}
