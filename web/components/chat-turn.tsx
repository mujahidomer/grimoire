import type { ChatSource } from "@/lib/types";
import { ChatMarkdown } from "@/components/chat-markdown";
import { ChatSourceLink } from "@/components/chat-source-link";

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
}: {
  turn: {
    question: string;
    answer: string;
    empty: boolean;
    sources: ChatSource[];
  };
  onSourceNavigate?: () => void;
}) {
  return (
    <div className="space-y-3">
      <ChatQuestionBubble>{turn.question}</ChatQuestionBubble>

      {turn.empty ? (
        <p className="prose-reading text-body-md text-eco-foreground/65">
          I don&apos;t have anything saved on that. Save some links on this
          topic and ask again.
        </p>
      ) : (
        <div className="space-y-3">
          <ChatMarkdown content={turn.answer} />
          {turn.sources.length > 0 && (
            <div className="space-y-1.5 border-t border-black/[0.06] pt-3">
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
        </div>
      )}
    </div>
  );
}
