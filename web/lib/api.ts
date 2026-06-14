import type { ChatResponse, Item, LinkedResource, SaveResponse } from "./types";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

// No user-level auth this phase (Doc B §Auth) — the backend's service-role key
// handles it. We still pass x-user-id so RLS scopes to the single testing user.
const USER_ID = process.env.NEXT_PUBLIC_GRIMOIRE_USER_ID ?? "";

function headers(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (USER_ID) h["x-user-id"] = USER_ID;
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

export async function fetchItems(query: ItemsQuery = {}): Promise<Item[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.tag) params.set("tag", query.tag);
  const qs = params.toString();
  const res = await fetch(`${BASE}/api/items${qs ? `?${qs}` : ""}`, {
    headers: headers(),
    cache: "no-store",
  });
  const data = await json<{ count: number; items: Item[] }>(res);
  return data.items;
}

export async function fetchItem(id: string): Promise<Item> {
  const res = await fetch(`${BASE}/api/items/${id}`, {
    headers: headers(),
    cache: "no-store",
  });
  const data = await json<{ item: Item }>(res);
  return data.item;
}

export async function fetchItemMarkdown(id: string): Promise<string> {
  const res = await fetch(`${BASE}/api/items/${id}?format=markdown`, {
    headers: headers(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load markdown (${res.status})`);
  return res.text();
}

export async function askChat(question: string): Promise<ChatResponse> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ question }),
  });
  return json<ChatResponse>(res);
}

export async function saveUrl(url: string): Promise<SaveResponse> {
  const res = await fetch(`${BASE}/api/save`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ url }),
  });
  // /api/save returns a structured body even on 4xx/5xx; surface its message.
  const data = (await res.json().catch(() => ({}))) as SaveResponse;
  if (!res.ok || !data.success) {
    throw new Error(data.message || data.error || "Couldn't save that link.");
  }
  return data;
}

export async function addLinkedResource(
  itemId: string,
  url: string,
): Promise<LinkedResource[]> {
  const res = await fetch(`${BASE}/api/items/${itemId}/linked-resources`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ url }),
  });
  const data = await json<{ success: boolean; linked_resources: LinkedResource[] }>(
    res,
  );
  return data.linked_resources;
}
