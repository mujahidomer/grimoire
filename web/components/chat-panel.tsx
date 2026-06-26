"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Maximize2, X } from "lucide-react";
import type { ChatSource } from "@/lib/types";
import { consumeChatStream } from "@/lib/api";
import { useOnboarding } from "@/lib/onboarding";
import { useChatUsage } from "@/lib/use-chat-usage";
import { Button } from "@/components/ui/button";
import { ChatTurn, ChatTurnDivider } from "@/components/chat-turn";
import { ChatUsageBar, DeepDiveToggle } from "@/components/chat-input-controls";

import type { ChatUsage } from "@/lib/api";

interface Turn {
  question: string;
  answer: string;
  empty: boolean;
  sources: ChatSource[];
  model?: string | null;
  usage?: ChatUsage | null;
}

export function ChatPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streamingTurn, setStreamingTurn] = useState<{
    turn: Turn;
    progress: string | null;
  } | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDeep, setIsDeep] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const deepRef = useRef(false);
  const { markQueryDone } = useOnboarding();
  const usage = useChatUsage();

  const sendQuestion = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loadingRef.current) return;
    markQueryDone();
    loadingRef.current = true;
    setLoading(true);
    try {
      const finalTurn = await consumeChatStream(trimmed, (live) => {
        setStreamingTurn({
          turn: {
            question: live.question,
            answer: live.answer,
            empty: live.empty,
            sources: live.sources,
            model: live.model,
            usage: live.usage,
          },
          progress: live.progress,
        });
      }, deepRef.current);
      setTurns((prev) => [
        ...prev,
        {
          question: finalTurn.question,
          answer: finalTurn.answer,
          empty: finalTurn.empty,
          sources: finalTurn.sources,
          model: finalTurn.model,
          usage: finalTurn.usage,
        },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          question: trimmed,
          answer: "Something went wrong reaching Grimoire. Try again.",
          empty: false,
          sources: [],
        },
      ]);
    } finally {
      setStreamingTurn(null);
      loadingRef.current = false;
      setLoading(false);
      usage.refresh();
    }
  }, [markQueryDone, usage]);

  useEffect(() => {
    deepRef.current = isDeep;
  }, [isDeep]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    function onAsk(e: Event) {
      const detail = (e as CustomEvent<{ question: string }>).detail;
      if (detail?.question) {
        sendQuestion(detail.question);
      }
    }
    window.addEventListener("grimoire:ask", onAsk);
    return () => window.removeEventListener("grimoire:ask", onAsk);
  }, [sendQuestion]);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, streamingTurn, loading]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q) return;
    setInput("");
    await sendQuestion(q);
  }

  if (!open) return null;

  return (
    <aside className="app-chat-sidebar">
      <div className="flex justify-center pt-2 lg:hidden" aria-hidden>
        <div className="h-1 w-10 rounded-full bg-black/10" />
      </div>

      <div className="flex items-center justify-between border-b border-eco-border-light px-4 py-3 lg:py-4">
        <span className="font-display text-lg font-normal text-eco-heading">
          Ask Grimoire
        </span>
        <div className="flex items-center gap-1">
          <Link
            href="/chat"
            aria-label="Open full-screen chat"
            title="Full screen"
            className="inline-flex h-9 w-9 items-center justify-center rounded-surface text-eco-foreground transition-colors duration-eco hover:bg-eco-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-border focus-visible:ring-offset-2"
          >
            <Maximize2 className="h-4 w-4" />
          </Link>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 space-y-6 overflow-y-auto px-4 py-5 scrollbar-thin"
      >
        {turns.length === 0 && !loading && (
          <p className="font-sans text-body-md text-eco-foreground/65">
            Ask a question about anything in your library.
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i}>
            {i > 0 && <ChatTurnDivider />}
            <ChatTurn turn={turn} />
          </div>
        ))}

        {streamingTurn && (
          <div>
            {turns.length > 0 && <ChatTurnDivider />}
            <ChatTurn
              turn={streamingTurn.turn}
              progress={streamingTurn.progress}
            />
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="flex flex-col border-t border-eco-border-light px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:py-4 lg:pb-4"
      >
        <ChatUsageBar state={usage} isDeep={isDeep} />
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask a question…"
            className="h-9 min-w-0 flex-1 rounded-lg border border-eco-border-muted bg-eco-surface px-3 font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/55 focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary"
          />
          <Button
            type="submit"
            size="sm"
            disabled={loading || !input.trim() || usage.atLimit}
          >
            Send
          </Button>
        </div>
        <div className="pt-2">
          <DeepDiveToggle isDeep={isDeep} onChange={setIsDeep} disabled={loading} />
        </div>
      </form>
    </aside>
  );
}
