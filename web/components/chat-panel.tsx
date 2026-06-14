"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, X } from "lucide-react";
import type { ChatSource } from "@/lib/types";
import { askChat } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { ChatMarkdown } from "@/components/chat-markdown";

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
  const loadingRef = useRef(false);

  const sendQuestion = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed || loadingRef.current) return;
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
  }, []);

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
      <div className="flex items-center justify-between border-b border-eco-border-light px-4 py-4">
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
          <p className="font-sans text-body-md text-eco-foreground/50">
            Ask a question about anything in your library.
          </p>
        )}

        {turns.map((turn, i) => (
          <div key={i} className="space-y-3">
            <p className="font-sans text-body-md font-medium text-eco-heading">
              {turn.question}
            </p>

            {turn.empty ? (
              <p className="prose-reading text-body-md text-eco-foreground/50">
                I don&apos;t have anything saved on that. Save some links on
                this topic and ask again.
              </p>
            ) : (
              <div className="space-y-3">
                <ChatMarkdown content={turn.answer} />
                {turn.sources.length > 0 && (
                  <div className="space-y-1.5 border-t border-black/[0.06] pt-3">
                    <p className="font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/50">
                      Sources
                    </p>
                    <ul className="space-y-1">
                      {turn.sources.map((s) => (
                        <li key={s.id}>
                          <Link
                            href={`/item/${s.id}`}
                            className="font-sans text-body-md text-eco-secondary transition-colors duration-eco hover:text-eco-primary hover:underline"
                          >
                            {s.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-eco-foreground/50">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span className="font-sans text-body-md">Thinking…</span>
          </div>
        )}
      </div>

      <form
        onSubmit={send}
        className="flex items-center gap-2 border-t border-eco-border-light px-4 py-4"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask a question…"
          className="h-9 min-w-0 flex-1 rounded-lg border border-black/[0.08] bg-white px-3 font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/40 focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary"
        />
        <Button type="submit" size="sm" disabled={loading || !input.trim()}>
          Send
        </Button>
      </form>
    </aside>
  );
}
