import type { ChatUsage } from "@/lib/api";
import type { ChatSource } from "@/lib/types";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatSourceLink } from "@/components/chat-source-link";
import { hasInlineCitations } from "@/lib/linkify-citations";
import { Loader2 } from "lucide-react";

function formatTokenCount(n: number): string {
  return n.toLocaleString();
}

function ChatAnswerMeta({
  model,
  usage,
}: {
  model: string;
  usage: ChatUsage;
}) {
  const total = usage.input_tokens + usage.output_tokens;
  return (
    <p className="pt-1 font-sans text-label-md text-eco-foreground/65">
      {formatTokenCount(total)} tokens ({formatTokenCount(usage.input_tokens)} in,{" "}
      {formatTokenCount(usage.output_tokens)} out) · {model}
    </p>
  );
}

export function ChatTurnDivider() {
  return (
    <div className="flex items-center justify-center py-2" aria-hidden>
      <svg
        className="h-2 w-28 text-eco-border/70"
        viewBox="0 0 112 8"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d="M0 4 C7 1.5, 14 6.5, 21 4 S35 1.5, 42 4 S56 6.5, 63 4 S77 1.5, 84 4 S98 6.5, 105 4 S112 1.5, 112 4"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

export function ChatQuestionBubble({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[90%] rounded-[18px] rounded-br-sm bg-eco-secondary/[0.07] px-3.5 py-2.5 font-sans text-body-md leading-snug text-eco-heading ring-1 ring-black/[0.05]">
        {children}
      </div>
    </div>
  );
}

export function ChatTurn({
  turn,
  onSourceNavigate,
  progress,
}: {
  turn: {
    question: string;
    answer: string;
    empty: boolean;
    sources: ChatSource[];
    model?: string | null;
    usage?: ChatUsage | null;
  };
  onSourceNavigate?: () => void;
  progress?: string | null;
}) {
  // Sources render inline as citation chips inside the answer. The bottom
  // Sources list is a fallback, shown only when no inline chip was rendered.
  const showSourcesFallback =
    turn.sources.length > 0 && !hasInlineCitations(turn.answer, turn.sources);

  return (
    <div className="space-y-3">
      <ChatQuestionBubble>{turn.question}</ChatQuestionBubble>

      {progress && (
        <div className="flex items-center gap-2 text-eco-foreground/65">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span className="font-sans text-body-md">{progress}</span>
        </div>
      )}

      {turn.empty ? (
        <p className="prose-reading text-body-md text-eco-foreground/65">
          I don&apos;t have anything saved on that. Save some links on this
          topic and ask again.
        </p>
      ) : (
        <div className="space-y-3">
          {turn.answer ? (
            <ChatMarkdown
              content={turn.answer}
              sources={turn.sources}
              onSourceNavigate={onSourceNavigate}
            />
          ) : null}
          {showSourcesFallback && (
            <div className="space-y-1.5 border-t border-eco-border-subtle pt-3">
              <p className="font-sans text-label-md font-light uppercase tracking-wide text-eco-foreground/65">
                Sources
              </p>
              <ul className="space-y-2">
                {turn.sources.map((s) => (
                  <li key={s.id}>
                    <ChatSourceLink
                      source={s}
                      onNavigate={onSourceNavigate}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {turn.model && turn.usage && (
            <ChatAnswerMeta model={turn.model} usage={turn.usage} />
          )}
        </div>
      )}
    </div>
  );
}
