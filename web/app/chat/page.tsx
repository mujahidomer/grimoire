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
import type { ChatUsage } from "@/lib/api";
import { chatProgressLabel, streamChatEvents } from "@/lib/api";
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
  model: string | null;
  usage: ChatUsage | null;
}

// Streaming wrapper: `phase` tells whether the pipeline is still running its
// retrieval steps or has started writing the answer.
interface StreamingTurn {
  turn: PageTurn;
  phase: "process" | "answer";
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
    model: null,
    usage: null,
  };
}

// Collapsible pipeline trace shown above an answer (Agentric-style). Expanded
// while the query runs; collapses to a one-line summary once the answer lands.
function ProcessSteps({
  steps,
  active,
}: {
  steps: Step[];
  active: boolean;
}) {
  const [open, setOpen] = useState(true);

  // Auto-collapse when the run finishes; auto-open while it's live.
  useEffect(() => {
    setOpen(active);
  }, [active]);

  if (steps.length === 0) return null;

  const summary = active
    ? steps[steps.length - 1].label
    : `${steps.length} ${steps.length === 1 ? "step" : "steps"} · done`;

  return (
    <div className="rounded-xl border border-eco-border-subtle bg-eco-surface/60">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 shrink-0 text-eco-foreground/55 transition-transform duration-eco ${
            open ? "rotate-90" : ""
          }`}
        />
        {active ? (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-eco-primary" />
        ) : (
          <Check className="h-3.5 w-3.5 shrink-0 text-eco-primary" />
        )}
        <span className="truncate font-sans text-label-md text-eco-foreground/70">
          {summary}
        </span>
      </button>

      {open && (
        <ul className="space-y-1.5 border-t border-eco-border-subtle px-3 py-2.5">
          {steps.map((step, i) => {
            const isLast = i === steps.length - 1;
            const running = active && isLast;
            return (
              <li
                key={step.key}
                className="flex items-center gap-2 font-sans text-label-md text-eco-foreground/75"
              >
                {running ? (
                  <Loader2 className="h-3 w-3 shrink-0 animate-spin text-eco-primary" />
                ) : (
                  <Check className="h-3 w-3 shrink-0 text-eco-primary/70" />
                )}
                <span className="truncate">{step.label}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function TurnView({
  turn,
  phase,
}: {
  turn: PageTurn;
  phase: "process" | "answer" | "done";
}) {
  const showSourcesFallback =
    turn.sources.length > 0 && !hasInlineCitations(turn.answer, turn.sources);

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-[18px] rounded-br-sm bg-eco-secondary/[0.07] px-4 py-2.5 font-sans text-body-md leading-snug text-eco-heading ring-1 ring-black/[0.05]">
          {turn.question}
        </div>
      </div>

      <ProcessSteps steps={turn.steps} active={phase === "process"} />

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
  const [streaming, setStreaming] = useState<StreamingTurn | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDeep, setIsDeep] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const deepRef = useRef(false);

  const { markQueryDone } = useOnboarding();
  const usage = useChatUsage();

  useEffect(() => {
    deepRef.current = isDeep;
  }, [isDeep]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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
      let phase: "process" | "answer" = "process";
      setStreaming({ turn: { ...turn }, phase });

      try {
        for await (const event of streamChatEvents(question, deepRef.current)) {
          if (event.type === "progress") {
            const label = chatProgressLabel(
              event.step,
              "count" in event ? event.count : undefined,
              deepRef.current,
            );
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
          } else if (event.type === "meta") {
            turn.model = event.model;
            turn.usage = event.usage;
          }
          setStreaming({ turn: { ...turn, steps: [...turn.steps] }, phase });
        }
        setTurns((prev) => [...prev, { ...turn, steps: [...turn.steps] }]);
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
    [markQueryDone, usage],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    runQuery(q);
  }

  function onSuggestion(q: string) {
    if (loadingRef.current) return;
    setInput("");
    runQuery(q);
  }

  function newChat() {
    if (loadingRef.current) return;
    setTurns([]);
    setStreaming(null);
    setInput("");
    inputRef.current?.focus();
  }

  // History = every question asked this session, most recent first.
  const history = [
    ...(streaming ? [streaming.turn.question] : []),
    ...turns.map((t) => t.question).reverse(),
  ];

  const isEmpty = turns.length === 0 && !streaming;

  return (
    <div className="flex h-[100dvh] w-full overflow-hidden bg-eco-canvas">
      {/* Sidebar — chat history + usage indicator pinned to the bottom. */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-eco-border-subtle bg-eco-sidebar md:flex">
        <div className="p-3">
          <button
            type="button"
            onClick={newChat}
            className="flex w-full items-center gap-2 rounded-lg border border-eco-border-muted bg-eco-surface px-3 py-2 font-sans text-body-md font-medium text-eco-on-surface transition-colors duration-eco hover:bg-eco-surface-raised"
          >
            <Plus className="h-4 w-4" />
            New chat
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 scrollbar-thin">
          {history.length === 0 ? (
            <p className="px-2 py-2 font-sans text-label-md text-eco-foreground/55">
              Your questions show up here.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {history.map((q, i) => (
                <li key={`${i}-${q}`}>
                  <div
                    title={q}
                    className="truncate rounded-md px-2 py-1.5 font-sans text-label-md text-eco-foreground/75 transition-colors duration-eco hover:bg-eco-hover"
                  >
                    {q}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-eco-border-subtle px-2 py-2">
          <ChatUsageBar state={usage} isDeep={isDeep} />
        </div>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-3 border-b border-eco-border-subtle bg-eco-main px-4 py-3">
          <Link
            href="/"
            aria-label="Back to library"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-eco-foreground/70 transition-colors duration-eco hover:bg-eco-hover hover:text-eco-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <span className="inline-flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-eco-primary" />
            <span className="font-display text-lg font-normal text-eco-heading">
              Grimoire
            </span>
          </span>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin">
          <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col px-4 py-6">
            {isEmpty ? (
              <div className="flex flex-1 flex-col items-center justify-center text-center">
                <Sparkles className="mb-4 h-8 w-8 text-eco-primary" />
                <h1 className="font-display text-[34px] font-normal leading-tight text-eco-heading">
                  Ask Grimoire
                </h1>
                <p className="mt-2 font-sans text-body-md text-eco-foreground/65">
                  Ask anything about what you&apos;ve saved.
                </p>
                <div className="mt-7 grid w-full max-w-[560px] grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => onSuggestion(s)}
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

        {/* Input area pinned to the bottom of the main column. */}
        <div className="shrink-0 border-t border-eco-border-subtle bg-eco-main px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <form onSubmit={submit} className="mx-auto w-full max-w-[720px]">
            <div className="rounded-2xl border border-eco-border-muted bg-eco-surface p-2 shadow-eco-sm focus-within:border-eco-primary">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                className="h-9 w-full bg-transparent px-2 font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/55 focus:outline-none"
              />
              <div className="flex items-center justify-between gap-2 px-1 pt-1">
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
            {/* Usage bar also lives at the input on narrow screens (sidebar hidden). */}
            <div className="mt-2 md:hidden">
              <ChatUsageBar state={usage} isDeep={isDeep} />
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
