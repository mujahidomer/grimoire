import type {
  ConsolidateSubcategoriesResponse,
  DashboardResponse,
  DigestResponse,
  Item,
  LinkedResource,
  LinkPreview,
  SaveResponse,
  ChatSource,
  SubcategoriesResponse,
  SubcategoryMergeGroup,
  TopCategoryRecord,
} from "./types";
import { topCategoryFromSlug } from "./types";
import { createClient as createBrowserClient } from "./supabase/client";
import { devAuthUserId } from "./dev-auth";

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
const REQUEST_TIMEOUT_MS = 15000;
// /api/save now responds as soon as a pending row is written (target <500ms) —
// extraction/classification run in a detached background job server-side, not
// inline in the request. No need for a long client-side allowance anymore; this
// only needs to cover a slow/flaky connection to deliver that fast ack.
const SAVE_REQUEST_TIMEOUT_MS = 15000;

export interface ChatUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ChatUsageInfo {
  queryCount: number;
  deepCount: number;
  remaining: number;
  resetAt: string;
  unlimited?: boolean;
}

export type ChatStreamEvent =
  | { type: "progress"; step: "searching" }
  | { type: "progress"; step: "analysing" }
  | { type: "progress"; step: "reranking"; count: number }
  | { type: "progress"; step: "synthesizing"; count: number }
  | { type: "text"; text: string }
  | { type: "meta"; model: string; usage: ChatUsage }
  | { type: "sources"; sources: ChatSource[] }
  | { type: "empty" }
  | { type: "limit"; remaining: number; resetAt: string }
  | { type: "done"; chatId: string | null }
  | { type: "error"; message: string };

// One row in the chat-history sidebar.
export interface ChatSummary {
  id: string;
  title: string | null;
  created_at: string;
}

// A persisted message when restoring a past conversation.
export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export function chatProgressLabel(
  step: "searching" | "analysing" | "reranking" | "synthesizing",
  count?: number,
  isDeep = false,
): string {
  if (step === "searching") {
    return isDeep
      ? "Deep searching your library..."
      : "Searching your library...";
  }
  if (step === "analysing") return "Analysing your library...";
  if (step === "reranking" && count != null) {
    return `Found ${count} results, finding the best ones...`;
  }
  if (step === "synthesizing" && count != null) {
    return `Synthesising from ${count} sources...`;
  }
  return "Thinking…";
}

// Today's chat credit usage — fed to the usage bar above the chat input.
export async function fetchChatUsage(): Promise<ChatUsageInfo> {
  const res = await withTimeout(`${BASE}/api/chat/usage`, {
    headers: await clientAuthHeaders(),
    cache: "no-store",
  });
  return json<ChatUsageInfo>(res);
}

// Recent chats for the history sidebar (newest first).
export async function fetchChats(): Promise<ChatSummary[]> {
  const res = await withTimeout(`${BASE}/api/chats`, {
    headers: await clientAuthHeaders(),
    cache: "no-store",
  });
  const data = await json<{ chats: ChatSummary[] }>(res);
  return data.chats;
}

// Full transcript of one chat, oldest first.
export async function fetchChatMessages(
  chatId: string,
): Promise<StoredMessage[]> {
  const res = await withTimeout(`${BASE}/api/chats/${chatId}/messages`, {
    headers: await clientAuthHeaders(),
    cache: "no-store",
  });
  const data = await json<{ messages: StoredMessage[] }>(res);
  return data.messages;
}

function timeoutMessage(timeoutMs: number): string {
  const seconds = Math.round(timeoutMs / 1000);
  if (/localhost|127\.0\.0\.1/.test(BASE)) {
    return `Request timed out after ${seconds}s. Check that localhost services are running.`;
  }
  return `Request timed out after ${seconds}s. The server may still be processing — try again in a moment.`;
}

function withTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const mergedInit: RequestInit = { ...init, signal: controller.signal };

  return fetch(input, mergedInit)
    .catch((error: unknown) => {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(timeoutMessage(timeoutMs));
      }
      throw error;
    })
    .finally(() => clearTimeout(timeoutId));
}

// Legacy dev fallback when Supabase auth is not configured.
const LEGACY_USER_ID = process.env.NEXT_PUBLIC_GRIMOIRE_USER_ID ?? "";

function devBypassHeaders(): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  const userId = devAuthUserId();
  if (userId) h["x-user-id"] = userId;
  return h;
}

async function clientAuthHeaders(): Promise<HeadersInit> {
  if (devAuthUserId()) return devBypassHeaders();

  const h: Record<string, string> = { "Content-Type": "application/json" };

  try {
    const supabase = createBrowserClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (session?.access_token) {
      h.Authorization = `Bearer ${session.access_token}`;
      return h;
    }
  } catch {
    /* browser client unavailable (SSR) */
  }

  if (LEGACY_USER_ID) h["x-user-id"] = LEGACY_USER_ID;
  return h;
}

const itemCache = new Map<string, Promise<Item>>();

async function requestItem(
  id: string,
  accessToken?: string | null,
): Promise<Item> {
  const headers =
    accessToken !== undefined
      ? serverAuthHeaders(accessToken)
      : await clientAuthHeaders();
  const res = await withTimeout(`${BASE}/api/items/${id}`, {
    headers,
    cache: "no-store",
  });
  const data = await json<{ item: Item }>(res);
  return data.item;
}

function trackItemRequest(id: string, promise: Promise<Item>): Promise<Item> {
  const tracked = promise.catch((error) => {
    itemCache.delete(id);
    throw error;
  });
  itemCache.set(id, tracked);
  return tracked;
}

export function prefetchItem(id: string): void {
  if (!id || itemCache.has(id)) return;
  trackItemRequest(id, requestItem(id));
}

export function invalidateItemCache(id: string): void {
  itemCache.delete(id);
}

function serverAuthHeaders(accessToken: string | null | undefined): HeadersInit {
  if (devAuthUserId()) return devBypassHeaders();

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
  limit?: number;
  // New hierarchical category params — additive alongside the legacy
  // `category` (flat) filter above.
  topCategory?: string;
  subcategory?: string;
}

export async function fetchItems(
  query: ItemsQuery = {},
  accessToken?: string | null,
): Promise<Item[]> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.category) params.set("category", query.category);
  if (query.tag) params.set("tag", query.tag);
  if (query.limit != null) params.set("limit", String(query.limit));
  if (query.topCategory) params.set("top_category", query.topCategory);
  if (query.subcategory) params.set("subcategory", query.subcategory);
  const qs = params.toString();
  const headers =
    accessToken !== undefined
      ? serverAuthHeaders(accessToken)
      : await clientAuthHeaders();
  const res = await withTimeout(`${BASE}/api/items${qs ? `?${qs}` : ""}`, {
    headers,
    cache: "no-store",
  });
  const data = await json<{ count: number; items: Item[] }>(res);
  return data.items;
}

// Library Digest — structured artifacts grouped by artifact_type. Grouping and
// sorting happen server-side; we just pass through the shaped response.
export async function fetchDigest(
  accessToken?: string | null,
): Promise<DigestResponse> {
  const headers =
    accessToken !== undefined
      ? serverAuthHeaders(accessToken)
      : await clientAuthHeaders();
  const res = await withTimeout(`${BASE}/api/digest`, {
    headers,
    cache: "no-store",
  });
  return json<DigestResponse>(res);
}

// The live, ordered top-level category list from the data-driven backend table
// (name, slug, emoji). Public reference data — no auth — so both server and
// client components can call it. Returns [] on any failure; callers fall back to
// the built-in TOP_CATEGORIES seed.
export async function fetchTopCategories(): Promise<TopCategoryRecord[]> {
  try {
    const res = await withTimeout(`${BASE}/api/top-categories`, {
      cache: "no-store",
    });
    const data = await json<{ categories: TopCategoryRecord[] }>(res);
    return data.categories ?? [];
  } catch {
    return [];
  }
}

// Resolve a /home/[categorySlug] slug to its canonical top_category name using
// the LIVE list (so DB-added categories resolve). If the live list loads and the
// slug isn't in it, returns null (caller notFound()s). If the list can't be
// fetched, falls back to the built-in slug map so existing categories still work.
export async function resolveTopCategorySlug(
  slug: string,
): Promise<string | null> {
  const records = await fetchTopCategories();
  const match = records.find((r) => r.slug === slug);
  if (match) return match.name;
  if (records.length > 0) return null;
  return topCategoryFromSlug(slug);
}

// Category dashboard landing (/home) — the top categories (from the data-driven
// list) with counts and their latest item, plus the 8 most-recently-saved items.
export async function fetchDashboard(
  accessToken?: string | null,
): Promise<DashboardResponse> {
  const headers =
    accessToken !== undefined
      ? serverAuthHeaders(accessToken)
      : await clientAuthHeaders();
  const res = await withTimeout(`${BASE}/api/dashboard`, {
    headers,
    cache: "no-store",
  });
  return json<DashboardResponse>(res);
}

// Topic subcategories nested under one top_category, sorted by count desc.
export async function fetchSubcategories(
  topCategory: string,
  accessToken?: string | null,
): Promise<SubcategoriesResponse> {
  const params = new URLSearchParams({ top_category: topCategory });
  const headers =
    accessToken !== undefined
      ? serverAuthHeaders(accessToken)
      : await clientAuthHeaders();
  const res = await withTimeout(`${BASE}/api/subcategories?${params}`, {
    headers,
    cache: "no-store",
  });
  return json<SubcategoriesResponse>(res);
}

// Move an item to a different top_category. The server resets its
// subcategory to "General" and marks category_manually_set.
export async function recategorizeItem(
  id: string,
  topCategory: string,
): Promise<Item> {
  const res = await withTimeout(`${BASE}/api/items/${id}/category`, {
    method: "PATCH",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({ top_category: topCategory }),
  });
  const data = await json<{ item: Item }>(res);
  invalidateItemCache(id);
  return data.item;
}

// Preview (apply: false) or perform (apply: true) merging near-duplicate
// subcategories. Always call with apply:false first to show a preview —
// never apply directly without the user confirming the proposed merges.
export async function consolidateSubcategories(opts: {
  topCategory?: string;
  apply: boolean;
  // On apply, pass back the previewed groups so the server applies exactly
  // what the user confirmed instead of re-proposing (which could differ).
  groups?: SubcategoryMergeGroup[];
}): Promise<ConsolidateSubcategoriesResponse> {
  const res = await withTimeout(`${BASE}/api/subcategories/consolidate`, {
    method: "POST",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({
      top_category: opts.topCategory,
      apply: opts.apply,
      groups: opts.groups,
    }),
  });
  return json<ConsolidateSubcategoriesResponse>(res);
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
  const res = await withTimeout(`${BASE}/api/link-preview?${params}`, {
    cache: "no-store",
  });
  const data = await json<{ preview: LinkPreview }>(res);
  return data.preview;
}

export async function fetchItem(
  id: string,
  accessToken?: string | null,
): Promise<Item> {
  if (accessToken !== undefined) {
    return requestItem(id, accessToken);
  }

  const cached = itemCache.get(id);
  if (cached) return cached;
  return trackItemRequest(id, requestItem(id));
}

export async function fetchItemMarkdown(id: string): Promise<string> {
  const res = await withTimeout(`${BASE}/api/items/${id}?format=markdown`, {
    headers: await clientAuthHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Failed to load markdown (${res.status})`);
  return res.text();
}

export async function* streamChatEvents(
  question: string,
  isDeep = false,
  chatId?: string | null,
): AsyncGenerator<ChatStreamEvent> {
  const res = await fetch(`${BASE}/api/chat`, {
    method: "POST",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({ question, isDeep, chatId: chatId ?? undefined }),
  });

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

  if (!res.body) throw new Error("No response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      const line = part
        .split("\n")
        .map((l) => l.trim())
        .find((l) => l.startsWith("data: "));
      if (!line) continue;

      const payload = line.slice(6);
      if (payload === "[DONE]") return;

      const event = JSON.parse(payload) as ChatStreamEvent;
      if (event.type === "error") {
        throw new Error(event.message);
      }
      yield event;
    }
  }
}

export interface StreamingChatTurn {
  question: string;
  answer: string;
  empty: boolean;
  sources: ChatSource[];
  model: string | null;
  usage: ChatUsage | null;
  progress: string | null;
  limit: { remaining: number; resetAt: string } | null;
  chatId: string | null;
}

export async function consumeChatStream(
  question: string,
  onUpdate: (turn: StreamingChatTurn) => void,
  isDeep = false,
  chatId?: string | null,
): Promise<StreamingChatTurn> {
  const turn: StreamingChatTurn = {
    question,
    answer: "",
    empty: false,
    sources: [],
    model: null,
    usage: null,
    progress: chatProgressLabel("searching", undefined, isDeep),
    limit: null,
    chatId: chatId ?? null,
  };
  onUpdate({ ...turn });

  for await (const event of streamChatEvents(question, isDeep, chatId)) {
    if (event.type === "progress") {
      turn.progress = chatProgressLabel(event.step, "count" in event ? event.count : undefined, isDeep);
    } else if (event.type === "text") {
      turn.answer += event.text;
      turn.progress = null;
    } else if (event.type === "empty") {
      turn.empty = true;
      turn.progress = null;
    } else if (event.type === "limit") {
      turn.limit = { remaining: event.remaining, resetAt: event.resetAt };
      turn.progress = null;
    } else if (event.type === "sources") {
      turn.sources = event.sources;
      turn.progress = null;
    } else if (event.type === "meta") {
      turn.model = event.model;
      turn.usage = event.usage;
    } else if (event.type === "done") {
      turn.chatId = event.chatId;
    }
    onUpdate({ ...turn });
  }

  turn.progress = null;
  onUpdate({ ...turn });
  return turn;
}

export async function saveUrl(
  url: string,
  opts: { keepalive?: boolean } = {},
): Promise<SaveResponse> {
  const res = await withTimeout(
    `${BASE}/api/save`,
    {
      method: "POST",
      headers: await clientAuthHeaders(),
      body: JSON.stringify({ url }),
      // Belt-and-suspenders: the backend now responds almost instantly (see
      // /api/save in index.js), so there's very little window left for iOS
      // backgrounding to interrupt. keepalive still helps that last stretch —
      // no harm in keeping it — but it is no longer load-bearing.
      keepalive: opts.keepalive,
    },
    SAVE_REQUEST_TIMEOUT_MS,
  );
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

export interface SeedLibraryResult {
  accepted: number;
  seeded: number;
  skipped: number;
}

// Copy pre-processed seed items into the just-created user's library. The user
// id is derived server-side from the auth token, so we only send ids. The
// backend awaits seeding before responding so the library refresh sees items.
export async function seedLibrary(
  selectedItemIds: string[],
): Promise<SeedLibraryResult> {
  if (!selectedItemIds.length) {
    return { accepted: 0, seeded: 0, skipped: 0 };
  }
  const res = await withTimeout(`${BASE}/api/seed`, {
    method: "POST",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({ selectedItemIds }),
  });
  if (!res.ok) throw new Error(`seed request failed (${res.status})`);
  return json<SeedLibraryResult>(res);
}

export async function deleteItem(id: string): Promise<void> {
  const res = await withTimeout(`${BASE}/api/items/${id}`, {
    method: "DELETE",
    headers: await clientAuthHeaders(),
  });
  await json<{ success: boolean }>(res);
  invalidateItemCache(id);
}

export async function addLinkedResource(
  itemId: string,
  url: string,
): Promise<LinkedResource[]> {
  const res = await withTimeout(`${BASE}/api/items/${itemId}/linked-resources`, {
    method: "POST",
    headers: await clientAuthHeaders(),
    body: JSON.stringify({ url }),
  });
  const data = await json<{ success: boolean; linked_resources: LinkedResource[] }>(
    res,
  );
  return data.linked_resources;
}
