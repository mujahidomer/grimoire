import ReactMarkdown from "react-markdown";

export function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="prose-serif space-y-2 text-sm [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        components={{
        p: ({ children }) => <p className="leading-relaxed">{children}</p>,
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-900">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        ol: ({ children }) => (
          <ol className="list-decimal space-y-2 pl-5">{children}</ol>
        ),
        ul: ({ children }) => (
          <ul className="list-disc space-y-2 pl-5">{children}</ul>
        ),
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-indigo-600 underline-offset-2 hover:underline"
          >
            {children}
          </a>
        ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
