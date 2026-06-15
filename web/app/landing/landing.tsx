"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

// Editorial, warm-stone marketing page. Colors are intentionally spec'd as
// arbitrary values here (warmer than the app interior) rather than the eco
// palette — this is the only public-facing surface with this treatment.
const PROBLEMS = [
  {
    title: "You live in tools and tabs.",
    body: "You save tools and workflows constantly. By the time you need them, they're buried.",
  },
  {
    title: "Your recipes are scattered.",
    body: "You've saved hundreds of recipes from everywhere. Standing in the kitchen, you can't remember which one fits.",
  },
  {
    title: "Your reading list is a graveyard.",
    body: "Dozens of articles saved, none retrievable. Grimoire makes everything you've read queryable.",
  },
];

const STEPS = [
  { n: "1", title: "Share any link", body: "From any app — articles, videos, posts, recipes." },
  { n: "2", title: "Grimoire extracts the knowledge", body: "It reads and structures what's inside, not just the URL." },
  { n: "3", title: "Ask across your library", body: "Question everything you've ever saved, in plain language." },
];

export function Landing() {
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const withNext = (path: string) =>
    next ? `${path}?next=${encodeURIComponent(next)}` : path;

  return (
    <div className="min-h-screen bg-[#EEEAE4] text-[#1C1C1A]">
      {/* Nav */}
      <nav className="flex justify-center px-6 py-8">
        <span className="font-display text-2xl tracking-tight text-[#1C1C1A]">
          Grimoire
        </span>
      </nav>

      {/* Hero */}
      <header className="mx-auto max-w-3xl px-6 pb-24 pt-12 text-center">
        <h1 className="font-display text-4xl leading-[1.1] tracking-tight text-[#1C1C1A] sm:text-5xl">
          Your saved knowledge, finally answerable.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[#8A8780]">
          You bookmark things meaning to come back. Grimoire extracts the
          knowledge inside every link so you can ask questions across everything
          you&apos;ve ever saved.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4">
          <Link
            href={withNext("/signup")}
            className="rounded-full bg-[#2D4B2D] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
          <Link
            href={withNext("/login")}
            className="text-sm font-medium text-[#2D4B2D] hover:underline"
          >
            Sign in
          </Link>
        </div>
      </header>

      {/* Problem */}
      <section className="border-t border-stone-200/70 px-6 py-20">
        <div className="mx-auto grid max-w-5xl gap-12 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title}>
              <h3 className="font-display text-xl tracking-tight text-[#1C1C1A]">
                {p.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[#8A8780]">
                {p.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-t border-stone-200/70 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-center font-display text-3xl tracking-tight text-[#1C1C1A]">
            How it works
          </h2>
          <div className="mt-12 grid gap-10 md:grid-cols-3">
            {STEPS.map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-stone-200 bg-white p-6"
              >
                <span className="font-display text-2xl text-[#2D4B2D]">
                  {s.n}
                </span>
                <h3 className="mt-3 font-display text-lg tracking-tight text-[#1C1C1A]">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#8A8780]">
                  {s.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Limitation / preview footer */}
      <section className="border-t border-stone-200/70 px-6 py-20">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs leading-relaxed text-[#8A8780]">
            This is an early version. Saving works via iOS Shortcut today. A
            native share extension, richer UI, and MCP integrations are coming.
          </p>
          <div className="mt-8">
            <Link
              href={withNext("/signup")}
              className="rounded-full bg-[#2D4B2D] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
            >
              Try it early
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
