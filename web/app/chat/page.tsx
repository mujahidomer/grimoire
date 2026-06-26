"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  Plus,
  Send,
  Sparkles,
} from "lucide-react";
import type { ChatSource } from "@/lib/types";
import type { ChatSummary, StoredMessage } from "@/lib/api";
import {
  chatProgressLabel,
  fetchChatMessages,
  fetchChats,
  streamChatEvents,
} from "@/lib/api";
import { useOnboarding } from "@/lib/onboarding";
import { useChatUsage } from "@/lib/use-chat-usage";
import { hasInlineCitations } from "@/lib/linkify-citations";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatSourceLink } from "@/components/chat-source-link";
import { ChatUsageBar, DeepDiveToggle } from "@/components/chat-input-controls";

interface Step {
  key: string;
  label: string;
}

interface PageTurn {
  question: string;
  answer: string;
  empty: boolean;
  sources: ChatSource[];
  steps: Step[];
  resultCount: number | null;
}

type Phase = "process" | "answer" | "done";

interface StreamingState {
  turn: PageTurn;
  phase: Exclude<Phase, "done">;
}

const SUGGESTIONS = [
  "What are the main themes of my saves?",
  "What tools have I saved this week?",
  "What did I save about AI agents?",
  "Show me my most saved topics",
];

function emptyTurn(question: string): PageTurn {
  return {
    question,
    answer: "",
    empty: false,
    sources: [],
    steps: [],
    resultCount: null,
  };
}

// "Just now" / "12m ago" / "3h ago" / "Yesterday" / "4d ago" / "Mar 2".
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "";
  const mins = Math.floor((Date.now() - then) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// Restore a stored transcript into question/answer turns. Persisted messages
// carry no retrieval steps or sources, so those stay empty on restore.
function pairMessages(messages: StoredMessage[]): PageTurn[] {
  const turns: PageTurn[] = [];
  for (const m of messages) {
    if (m.role === "user") {
      turns.push(emptyTurn(m.content));
    } else if (turns.length > 0) {
      turns[turns.length - 1].answer += m.content;
    }
  }
  return turns;
}

// Collapsible pipeline trace shown above an assistant answer. While the query
// runs it stays open and the active step shows a left-to-right indigo sweep;
// once the answer streams it collapses to "Searched N results" (click to open).
function ProcessSteps({
  steps,
  resultCount,
  active,
}: {
  steps: Step[];
  resultCount: number | null;
  active: boolean;
}) {
  const [open, setOpen] = useState(active);

  useEffect(() => {
    setOpen(active);
  }, [active]);

  if (steps.length === 0) return null;

  const summary = active
    ? steps[steps.length - 1]?.label ?? "Working…"
    : `Searched ${resultCount ?? steps.length} results`;

  return (
    <div className="rounded-xl border border-eco-border-subtle bg-eco-surface/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-eco-foreground/50 transition-transform duration-eco ${
            open ? "rotate-90" : ""
          }`}
        />
        {active ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-indigo-500" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-eco-primary" />
        )}
        <span className="truncate font-sans text-label-md text-eco-foreground/70">
          {summary}
        </span>
      </button>

      {open && (
        <ul className="space-y-2 border-t border-eco-border-subtle px-3 py-2.5">
          {steps.map((step, i) => {
            const running = active && i === steps.length - 1;
            return (
              <li key={step.key} className="chat-step">
                <div className="flex items-center gap-2 font-sans text-label-md text-eco-foreground/75">
                  {running ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-indigo-500" />
                  ) : (
                    <Check className="h-3 w-3 shrink-0 text-eco-primary/70" />
                  )}
                  <span className="truncate">{step.label}</span>
                </div>
                {running && (
                  <div className="chat-step-track ml-5 mt-1.5 h-[2px] w-[120px]">
                    <span />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TurnView({ turn, phase }: { turn: PageTurn; phase: Phase }) {
  const showSourcesFallback =
    turn.sources.length > 0 && !hasInlineCitations(turn.answer, turn.sources);

  return (
    <div className="space-y-3">
      {/* User message — right-aligned pill, max 70%. */}
      <div className="flex justify-end">
        <div className="max-w-[70%] rounded-[18px] rounded-br-sm bg-eco-secondary/[0.07] px-4 py-2.5 font-sans text-body-md leading-snug text-eco-heading ring-1 ring-black/[0.05]">
          {turn.question}
        </div>
      </div>

      <ProcessSteps
        steps={turn.steps}
        resultCount={turn.resultCount}
        active={phase === "process"}
      />

      {/* Assistant answer — left-aligned, full column width, no background. */}
      {turn.empty ? (
        <p className="prose-reading text-body-md text-eco-foreground/65">
          I don&apos;t have anything saved on that. Save some links on this
          topic and ask again.
        </p>
      ) : (
        <div className="space-y-3">
          {turn.answer ? (
            <ChatMarkdown content={turn.answer} sources={turn.sources} />
          ) : phase === "answer" ? (
            <div className="flex items-center gap-2 text-eco-foreground/55">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="font-sans text-body-md">Writing…</span>
            </div>
          ) : null}

          {showSourcesFallback && (
            <div className="space-y-1.5 border-t border-eco-border-subtle pt-3">
              <p className="font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/65">
                Sources
              </p>
              <ul className="space-y-2">
                {turn.sources.map((s) => (
                  <li key={s.id}>
                    <ChatSourceLink source={s} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPage() {
  const [turns, setTurns] = useState<PageTurn[]>([]);
  const [streaming, setStreaming] = useState<StreamingState | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDeep, setIsDeep] = useState(false);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const deepRef = useRef(false);
  const activeChatRef = useRef<string | null>(null);

  const { markQueryDone } = useOnboarding();
  const usage = useChatUsage();

  useEffect(() => {
    deepRef.current = isDeep;
  }, [isDeep]);

  useEffect(() => {
    activeChatRef.current = activeChatId;
  }, [activeChatId]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const refreshChats = useCallback(() => {
    fetchChats()
      .then(setChats)
      .catch(() => {
        /* sidebar history is non-critical — leave prior state on failure */
      });
  }, []);

  useEffect(() => {
    refreshChats();
  }, [refreshChats]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, streaming]);

  const runQuery = useCallback(
    async (raw: string) => {
      const question = raw.trim();
      if (!question || loadingRef.current || usage.atLimit) return;

      markQueryDone();
      loadingRef.current = true;
      setLoading(true);

      const turn = emptyTurn(question);
      let phase: Exclude<Phase, "done"> = "process";
      let resolvedChatId = activeChatRef.current;
      setStreaming({ turn: { ...turn }, phase });

      try {
        for await (const event of streamChatEvents(
          question,
          deepRef.current,
          activeChatRef.current,
        )) {
          if (event.type === "progress") {
            const count = "count" in event ? event.count : undefined;
            if (event.step === "reranking" && count != null) {
              turn.resultCount = count;
            }
            const label = chatProgressLabel(event.step, count, deepRef.current);
            const existing = turn.steps.find((s) => s.key === event.step);
            if (existing) existing.label = label;
            else turn.steps.push({ key: event.step, label });
          } else if (event.type === "text") {
            phase = "answer";
            turn.answer += event.text;
          } else if (event.type === "empty") {
            phase = "answer";
            turn.empty = true;
          } else if (event.type === "sources") {
            turn.sources = event.sources;
            if (turn.resultCount == null) turn.resultCount = event.sources.length;
          } else if (event.type === "done") {
            resolvedChatId = event.chatId;
          }
          setStreaming({ turn: { ...turn, steps: [...turn.steps] }, phase });
        }

        setTurns((prev) => [...prev, { ...turn, steps: [...turn.steps] }]);
        if (resolvedChatId && resolvedChatId !== activeChatRef.current) {
          activeChatRef.current = resolvedChatId;
          setActiveChatId(resolvedChatId);
        }
        refreshChats();
      } catch {
        setTurns((prev) => [
          ...prev,
          {
            ...turn,
            answer: "Something went wrong reaching Grimoire. Try again.",
          },
        ]);
      } finally {
        setStreaming(null);
        loadingRef.current = false;
        setLoading(false);
        usage.refresh();
      }
    },
    [markQueryDone, refreshChats, usage],
  );

  const loadChat = useCallback(
    async (id: string) => {
      if (loadingRef.current || id === activeChatRef.current) return;
      activeChatRef.current = id;
      setActiveChatId(id);
      setStreaming(null);
      try {
        const messages = await fetchChatMessages(id);
        setTurns(pairMessages(messages));
      } catch {
        setTurns([]);
      }
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [],
  );

  function newChat() {
    if (loadingRef.current) return;
    setTurns([]);
    setStreaming(null);
    setInput("");
    activeChatRef.current = null;
    setActiveChatId(null);
    inputRef.current?.focus();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    runQuery(q);
  }

  const isEmpty = turns.length === 0 && !streaming;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-eco-canvas">
      {/* ── Sidebar ─────────────────────────────────────────────── */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-eco-border-subtle bg-eco-sidebar md:flex">
        <div className="flex items-center justify-between px-4 pt-4">
          <span className="inline-flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-eco-primary" />
            <span className="font-display text-base font-normal text-eco-heading/80">
              Grimoire
            </span>
          </span>
          <Link
            href="/"
            className="font-sans text-label-md text-eco-foreground/60 transition-colors duration-eco hover:text-eco-foreground"
          >
            ← Library
          </Link>
        </div>

        <div className="px-3 pt-4">
          <button
            type="button"
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-lg border border-eco-border-muted bg-eco-surface px-3 py-2 font-sans text-body-md font-medium text-eco-on-surface transition-colors duration-eco hover:bg-eco-surface-raised"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        </div>

        <div className="mt-3 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
          {chats.length === 0 ? (
            <p className="px-2 py-2 font-sans text-label-md text-eco-foreground/55">
              Your conversations show up here.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {chats.map((c) => {
                const active = c.id === activeChatId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => loadChat(c.id)}
                      title={c.title ?? "Untitled"}
                      className={`flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors duration-eco ${
                        active
                          ? "bg-eco-primary/10"
                          : "hover:bg-eco-hover"
                      }`}
                    >
                      <span
                        className={`truncate font-sans text-body-md ${
                          active
                            ? "text-eco-heading"
                            : "text-eco-foreground/80"
                        }`}
                      >
                        {c.title ?? "Untitled"}
                      </span>
                      <span className="font-sans text-label-md text-eco-foreground/45">
                        {relativeTime(c.created_at)}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-eco-border-subtle px-2 py-2">
          <ChatUsageBar state={usage} isDeep={isDeep} />
        </div>
      </aside>

      {/* ── Main column ─────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Compact bar for mobile (sidebar hidden). */}
        <header className="flex shrink-0 items-center justify-between border-b border-eco-border-subtle bg-eco-main px-4 py-2.5 md:hidden">
          <Link
            href="/"
            aria-label="Back to library"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-eco-foreground/70 hover:bg-eco-hover"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="font-display text-base text-eco-heading">Grimoire</span>
          <button
            type="button"
            onClick={newChat}
            aria-label="New chat"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-eco-foreground/70 hover:bg-eco-hover"
          >
            <Plus className="h-4 w-4" />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto flex min-h-full w-full max-w-[680px] flex-col p-6">
            {isEmpty ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <Sparkles className="mb-4 h-8 w-8 text-eco-primary" />
                <h1 className="font-display text-[34px] font-normal leading-tight text-eco-heading">
                  Ask Grimoire
                </h1>
                <p className="mt-2 font-sans text-body-md text-eco-foreground/65">
                  Ask anything about what you&apos;ve saved.
                </p>
                <div className="mt-7 grid w-full max-w-[540px] grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => runQuery(s)}
                      disabled={usage.atLimit}
                      className="rounded-full border border-eco-border-muted bg-eco-surface px-4 py-2.5 text-left font-sans text-body-md text-eco-foreground/80 transition-colors duration-eco hover:border-eco-primary/40 hover:bg-eco-surface-raised hover:text-eco-heading disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {turns.map((turn, i) => (
                  <TurnView key={i} turn={turn} phase="done" />
                ))}
                {streaming && (
                  <TurnView turn={streaming.turn} phase={streaming.phase} />
                )}
              </div>
            )}
          </div>
        </div>

        {/* Input — floating card pinned to the bottom of the main column. */}
        <div className="shrink-0 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
          <form onSubmit={submit} className="mx-auto w-full max-w-[680px]">
            <div className="rounded-2xl border border-eco-border-muted bg-eco-surface p-2.5 shadow-eco-sm transition-colors duration-eco focus-within:border-eco-primary">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  turns.length > 0 ? "Ask a follow-up…" : "Ask a question…"
                }
                className="h-9 w-full bg-transparent px-2 font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/55 focus:outline-none"
              />
              <div className="flex items-center justify-between gap-2 pt-1">
                <DeepDiveToggle
                  isDeep={isDeep}
                  onChange={setIsDeep}
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !input.trim() || usage.atLimit}
                  aria-label="Send"
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-eco-primary text-eco-on-accent transition-colors duration-eco hover:bg-eco-tertiary disabled:pointer-events-none disabled:opacity-40"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
            {/* Usage also at the input on mobile, where the sidebar is hidden. */}
            <div className="mt-2 md:hidden">
              <ChatUsageBar state={usage} isDeep={isDeep} />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
