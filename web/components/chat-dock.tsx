"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, MessageCircle, Send, X } from "lucide-react";
import type { ChatSource } from "@/lib/types";
import { askChat } from "@/lib/api";
import { Button } from "@/components/ui/button";

interface Turn {
  question: string;
  answer: string;
  empty: boolean;
  sources: ChatSource[];
}

export function ChatDock() {
  const [open, setOpen] = useState(false);
  // Stateless per Doc B: history is cleared whenever the panel closes.
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
      {/* Floating "Ask Grimoire" button — visible on every screen */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-3 font-sans text-sm font-medium text-white shadow-lg transition-colors hover:bg-indigo-700"
        >
          <MessageCircle className="h-4 w-4" />
          Ask Grimoire
        </button>
      )}

      {open && (
        <>
          {/* Backdrop (mobile slide-up feel) */}
          <div
            className="fixed inset-0 z-30 bg-slate-900/20 sm:bg-transparent"
            onClick={close}
          />
          {/* Panel: bottom slide-up on mobile, right rail on desktop */}
          <div className="fixed inset-x-0 bottom-0 z-40 flex h-[80vh] flex-col rounded-t-lg border border-slate-200 bg-white shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[400px] sm:rounded-none sm:border-y-0 sm:border-r-0">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <span className="font-sans text-base font-semibold text-slate-900">
                Ask Grimoire
              </span>
              <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Messages */}
            <div
              ref={scrollRef}
              className="flex-1 space-y-6 overflow-y-auto px-5 py-5 scrollbar-thin"
            >
              {turns.length === 0 && !loading && (
                <p className="font-sans text-sm text-slate-400">
                  Ask a question about anything in your library.
                </p>
              )}

              {turns.map((turn, i) => (
                <div key={i} className="space-y-3">
                  {/* Question */}
                  <p className="font-sans text-sm font-medium text-slate-900">
                    {turn.question}
                  </p>

                  {/* Answer */}
                  {turn.empty ? (
                    <p className="prose-serif text-sm text-slate-400">
                      I don&apos;t have anything saved on that. Save some links
                      on this topic and ask again.
                    </p>
                  ) : (
                    <div className="space-y-3">
                      <p className="prose-serif whitespace-pre-wrap text-sm">
                        {turn.answer}
                      </p>
                      {turn.sources.length > 0 && (
                        <div className="space-y-1.5 border-t border-slate-100 pt-3">
                          <p className="font-sans text-xs font-medium uppercase tracking-wide text-slate-400">
                            Sources
                          </p>
                          <ul className="space-y-1">
                            {turn.sources.map((s) => (
                              <li key={s.id}>
                                <Link
                                  href={`/item/${s.id}`}
                                  onClick={close}
                                  className="font-sans text-sm text-indigo-600 hover:underline"
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
                <div className="flex items-center gap-2 text-slate-400">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="font-sans text-sm">Thinking…</span>
                </div>
              )}
            </div>

            {/* Input */}
            <form
              onSubmit={send}
              className="flex items-center gap-2 border-t border-slate-100 px-4 py-3"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Ask a question…"
                className="h-10 flex-1 rounded-lg border border-slate-200 bg-white px-3 font-sans text-sm text-slate-800 placeholder:text-slate-400 focus-visible:border-indigo-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
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
