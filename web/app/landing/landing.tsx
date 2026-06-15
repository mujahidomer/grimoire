"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  DEFAULT_SEGMENT,
  SEGMENTS,
  SEGMENT_BY_ID,
  SEGMENTS_STORAGE_KEY,
  type SegmentId,
} from "@/lib/seed-catalog";

const MAX_SEGMENTS = 2;

const STEPS = [
  { n: "1", title: "Share any link", body: "From any app — articles, videos, posts, recipes." },
  { n: "2", title: "Grimoire extracts the knowledge", body: "It reads and structures what's inside, not just the URL." },
  { n: "3", title: "Ask across your library", body: "Question everything you've ever saved, in plain language." },
];

export function Landing() {
  const router = useRouter();
  const [picked, setPicked] = useState<SegmentId[]>([]);
  const [active, setActive] = useState<SegmentId>(DEFAULT_SEGMENT);

  function toggle(id: SegmentId) {
    setActive(id);
    setPicked((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= MAX_SEGMENTS) return prev;
      return [...prev, id];
    });
  }

  function getStarted() {
    if (picked.length === 0) return;
    try {
      localStorage.setItem(SEGMENTS_STORAGE_KEY, JSON.stringify(picked));
    } catch {
      /* storage blocked — seed-picker falls back to all segments */
    }
    router.push("/seed-picker");
  }

  const problem = SEGMENT_BY_ID[active].problem;

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
        <img
          src="/icons/apple-touch-icon.png"
          alt="Grimoire"
          width={80}
          height={80}
          className="mx-auto mb-8 h-20 w-20"
        />
        <h1 className="font-display text-4xl leading-[1.1] tracking-tight text-[#1C1C1A] sm:text-5xl">
          Your saved knowledge, finally answerable.
        </h1>
        <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-[#8A8780]">
          You bookmark things meaning to come back. Grimoire extracts the
          knowledge inside every link so you can ask questions across everything
          you&apos;ve ever saved.
        </p>
        <div className="mt-10 flex flex-col items-center gap-4">
          <a
            href="#pick"
            className="rounded-full bg-[#2D4B2D] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90"
          >
            Get started
          </a>
          <Link
            href="/login"
            className="text-sm font-medium text-[#2D4B2D] hover:underline"
          >
            Sign in
          </Link>
        </div>
      </header>

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
                <span className="font-display text-2xl text-[#2D4B2D]">{s.n}</span>
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

      {/* Segment picker */}
      <section id="pick" className="border-t border-stone-200/70 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="font-display text-3xl tracking-tight text-[#1C1C1A]">
            What do you save most?
          </h2>
          <p className="mt-3 text-sm text-[#8A8780]">
            Pick what fits. We&apos;ll build you a starter library.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-3">
            {SEGMENTS.map((s) => {
              const selected = picked.includes(s.id);
              const disabled = !selected && picked.length >= MAX_SEGMENTS;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => toggle(s.id)}
                  disabled={disabled}
                  className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                    selected
                      ? "border-[#2D4B2D] bg-[#2D4B2D] text-white"
                      : "border-stone-300 bg-white text-[#1C1C1A] hover:border-stone-400"
                  } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
                >
                  {s.label}
                </button>
              );
            })}
          </div>

          {/* Problem copy for the selected segment */}
          {picked.length > 0 && (
            <div key={active} className="mx-auto mt-10 max-w-xl fade-in">
              <p className="text-base leading-relaxed text-[#1C1C1A]">{problem}</p>
            </div>
          )}

          <div className="mt-10">
            <button
              type="button"
              onClick={getStarted}
              disabled={picked.length === 0}
              className="rounded-full bg-[#2D4B2D] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Get started →
            </button>
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
        </div>
      </section>
    </div>
  );
}
