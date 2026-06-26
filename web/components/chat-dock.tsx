"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Maximize2, MessageCircle, Send, X } from "lucide-react";
import type { ChatSource } from "@/lib/types";
import { consumeChatStream } from "@/lib/api";
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

export function ChatDock() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streamingTurn, setStreamingTurn] = useState<{
    turn: Turn;
    progress: string | null;
  } | null>(null);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isDeep, setIsDeep] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const usage = useChatUsage();

  function close() {
    setOpen(false);
    setTurns([]);
    setStreamingTurn(null);
    setInput("");
  }

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [turns, streamingTurn, loading]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setLoading(true);
    try {
      const finalTurn = await consumeChatStream(q, (live) => {
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
      }, isDeep);
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
          question: q,
          answer: "Something went wrong reaching Grimoire. Try again.",
          empty: false,
          sources: [],
        },
      ]);
    } finally {
      setStreamingTurn(null);
      setLoading(false);
      usage.refresh();
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-30 inline-flex items-center gap-2 rounded-surface border border-eco-border-emphasis bg-eco-surface px-4 py-3 font-sans text-body-md font-medium text-eco-on-surface shadow-eco-lg transition-colors duration-eco hover:bg-eco-surface-raised"
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
          <div className="fixed inset-x-0 bottom-0 z-40 flex h-[80vh] flex-col rounded-t-card border border-eco-border bg-eco-input-solid shadow-eco-lg backdrop-blur-eco sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:w-[400px] sm:rounded-none sm:border-y-0 sm:border-r-0">
            <div className="flex items-center justify-between border-b border-eco-border/40 px-5 py-4">
              <span className="font-display text-lg font-light text-eco-on-surface">
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
                <Button variant="ghost" size="icon" onClick={close} aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div
              ref={scrollRef}
              className="flex-1 space-y-6 overflow-y-auto px-5 py-5 scrollbar-thin"
            >
              {turns.length === 0 && !loading && (
                <p className="font-sans text-body-md text-eco-foreground/65">
                  Ask a question about anything in your library.
                </p>
              )}

              {turns.map((turn, i) => (
                <div key={i}>
                  {i > 0 && <ChatTurnDivider />}
                  <ChatTurn turn={turn} onSourceNavigate={close} />
                </div>
              ))}

              {streamingTurn && (
                <div>
                  {turns.length > 0 && <ChatTurnDivider />}
                  <ChatTurn
                    turn={streamingTurn.turn}
                    progress={streamingTurn.progress}
                    onSourceNavigate={close}
                  />
                </div>
              )}
            </div>

            <form
              onSubmit={send}
              className="flex flex-col border-t border-eco-border/40 px-4 py-3"
            >
              <ChatUsageBar state={usage} isDeep={isDeep} />
              <div className="flex items-center gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask a question…"
                  className="h-10 flex-1 rounded-surface border border-eco-border bg-eco-input px-3 font-sans text-body-md text-eco-text backdrop-blur-eco placeholder:text-eco-text/60 focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary"
                />
                <Button
                  type="submit"
                  size="icon"
                  disabled={loading || !input.trim() || usage.atLimit}
                >
                  <Send className="h-4 w-4" />
                </Button>
              </div>
              <div className="pt-2">
                <DeepDiveToggle isDeep={isDeep} onChange={setIsDeep} disabled={loading} />
              </div>
            </form>
          </div>
        </>
      )}
    </>
  );
}
