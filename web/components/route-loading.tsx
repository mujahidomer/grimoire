function Pulse({ className }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-eco-border-subtle ${className ?? ""}`}
      aria-hidden
    />
  );
}

export function LibraryLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-10">
      <Pulse className="mb-8 h-9 w-40" />
      <div className="space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-2 py-3">
            <Pulse className="h-14 w-[4.5rem] shrink-0" />
            <div className="min-w-0 flex-1 space-y-2">
              <Pulse className="h-4 w-3/4" />
              <Pulse className="h-3 w-1/2" />
            </div>
            <Pulse className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function DigestLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-8 lg:py-10">
      <Pulse className="mb-8 h-9 w-48" />
      <div className="mb-6 flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Pulse key={i} className="h-9 w-24 rounded-full" />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <Pulse key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}

export function ItemLoading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 lg:px-8 lg:py-10">
      <Pulse className="mb-6 h-4 w-16" />
      <Pulse className="mb-6 aspect-video w-full rounded-xl" />
      <Pulse className="mb-4 h-10 w-4/5" />
      <Pulse className="mb-8 h-4 w-56" />
      <div className="space-y-3">
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-full" />
        <Pulse className="h-4 w-2/3" />
      </div>
    </div>
  );
}
