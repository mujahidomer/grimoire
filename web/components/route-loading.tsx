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

export function HomeDashboardLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
      <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <Pulse className="h-9 w-32" />
        <Pulse className="h-9 w-full max-w-lg" />
      </div>
      <div className="mb-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 13 }).map((_, i) => (
          <Pulse key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}

export function CategoryDetailLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
      <Pulse className="mb-4 h-4 w-24" />
      <Pulse className="mb-8 h-9 w-56" />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Pulse key={i} className="h-20 w-full" />
        ))}
      </div>
    </div>
  );
}

export function SubcategoryItemsLoading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-8 lg:py-10">
      <Pulse className="mb-4 h-4 w-40" />
      <Pulse className="mb-8 h-9 w-56" />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Pulse key={i} className="h-40 w-full" />
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
