"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";
import type { ChatSource } from "@/lib/types";
import { askChat } from "@/lib/api";
import { useOnboarding } from "@/lib/onboarding";
import { Button } from "@/components/ui/button";
import { ChatTurn, ChatTurnDivider } from "@/components/chat-turn";

interface Turn {
  question: string;
  answer: string;
  empty: boolean;
  sources: ChatSource[];
}

export function ChatPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const loadingRef = useRef(false);
  const { markQueryDone } = useOnboarding();

  const sendQuestion = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loadingRef.current) return;
    markQueryDone();
    loadingRef.current = true;
    setLoading(true);
    try {
      const res = await askChat(trimmed);
      setTurns((prev) => [
        ...prev,
        {
          question: trimmed,
          answer: res.answer,
          empty: res.empty,
          sources: res.sources,
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
      loadingRef.current = false;
      setLoading(false);
    }
  }, [markQueryDone]);

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
  }, [turns, loading]);

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
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close chat">
          <X className="h-4 w-4" />
        </Button>
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

        {loading && (
          <div className="flex items-center gap-2 text-eco-foreground/65">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-sans text-body-md">Thinking…</span>
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-eco-border-light px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:py-4 lg:pb-4"
      >
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-eco-border-muted bg-eco-surface px-3 font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/55 focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary"
        />
        <Button type="submit" size="sm" disabled={loading || !input.trim()}>
          Send
        </Button>
      </form>
    </aside>
  );
}
