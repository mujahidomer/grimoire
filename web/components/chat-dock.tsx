"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import type { ChatSource } from "@/lib/types";
import { askChat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChatTurn, ChatTurnDivider } from "@/components/chat-turn";

interface Turn {
  question: string;
  answer: string;
  empty: boolean;
  sources: ChatSource[];
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  function close() {
    setOpen(false);
    setTurns([]);
    setInput("");
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, loading]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);
    try {
      const res = await askChat(q);
      setTurns((prev) => [
        ...prev,
        { question: q, answer: res.answer, empty: res.empty, sources: res.sources },
      ]);
    } catch {
      setTurns((prev) => [
        ...prev,
        {
          question: q,
          answer: "Something went wrong reaching Grimoire. Try again.",
          empty: false,
          sources: [],
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-surface border border-black/[0.12] bg-eco-surface px-4 py-3 font-sans text-body-md font-medium text-eco-on-surface shadow-eco-lg transition-colors duration-eco hover:bg-white/90"
        >
          <MessageCircle className="h-4 w-4" />
          Ask Grimoire
        </button>
      )}

      {open && (
        <>
          <div
            className="fixed inset-0 z-30 bg-eco-secondary/20 sm:bg-transparent"
            onClick={close}
          />
          <div className="fixed inset-x-0 bottom-0 z-40 flex h-[80vh] flex-col rounded-t-card border border-eco-border bg-white/80 shadow-eco-lg backdrop-blur-eco sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[400px] sm:rounded-none sm:border-y-0 sm:border-r-0">
            <div className="flex items-center justify-between border-b border-eco-border/40 px-5 py-4">
              <span className="font-display text-lg font-light text-eco-on-surface">
                Ask Grimoire
              </span>
              <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 space-y-6 overflow-y-auto px-5 py-5 scrollbar-thin"
            >
              {turns.length === 0 && !loading && (
                <p className="font-sans text-body-md text-eco-foreground/50">
                  Ask a question about anything in your library.
                </p>
              )}

              {turns.map((turn, i) => (
                <div key={i}>
                  {i > 0 && <ChatTurnDivider />}
                  <ChatTurn turn={turn} onSourceNavigate={close} />
                </div>
              ))}

              {loading && (
                <div className="flex items-center gap-2 text-eco-text/50">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-sans text-body-md">Thinking…</span>
                </div>
              )}
            </div>

            <form
              onSubmit={send}
              className="flex items-center gap-2 border-t border-eco-border/40 px-4 py-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                className="h-10 flex-1 rounded-surface border border-eco-border bg-white/60 px-3 font-sans text-body-md text-eco-text backdrop-blur-eco placeholder:text-eco-text/50 focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary"
              />
              <Button type="submit" size="icon" disabled={loading || !input.trim()}>
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        </>
      )}
    </>
  );
}
