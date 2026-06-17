"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Check, Plus } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding";

const SHORTCUT_URL =
  "https://www.icloud.com/shortcuts/dd77a317524c429f9affb435899066a7";

export function ShortcutGuide() {
  const { markShortcutDone } = useOnboarding();

  useEffect(() => {
    markShortcutDone();
  }, [markShortcutDone]);

  return (
    <div className="min-h-screen bg-eco-main text-eco-heading">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <Link
          href="/"
          className="text-sm text-eco-muted transition-colors hover:text-eco-heading"
        >
          ← Back to library
        </Link>

        <header className="mt-6">
          <h1 className="font-display text-3xl leading-tight tracking-tight">
            Save from anywhere in one tap
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-eco-muted">
            The Grimoire shortcut lets you save any link from any app without
            opening Grimoire. It&apos;s a one-time setup.
          </p>
        </header>

        {/* Section 1 — install */}
        <section className="mt-10">
          <a
            href={SHORTCUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block rounded-full bg-eco-tertiary px-6 py-3 text-sm font-medium text-[var(--eco-on-accent)] transition-opacity hover:opacity-90"
          >
            Add Shortcut to iPhone
          </a>
        </section>

        {/* Section 2 — pin to share sheet */}
        <section className="mt-12">
          <h2 className="font-display text-xl tracking-tight">
            Then pin it so it appears every time you tap Share
          </h2>

          <div className="mt-6 space-y-6">
            <Step
              n={1}
              text="Tap Share on any page, scroll down, tap Edit Actions"
            >
              <ShareSheetEditActions />
            </Step>
            <Step
              n={2}
              text="Scroll down to find Save to Grimoire, tap + to add it"
            >
              <EditActionsList />
            </Step>
            <Step n={3} text="It moves into your Favourites — drag it to the top">
              <FavouritesList />
            </Step>
            <Step n={4} text="Tap Done — you're set">
              <ShareSheetQuickActions />
            </Step>
          </div>
        </section>

        {/* Section 3 — paste fallback */}
        <section className="mt-12 border-t border-eco-border-light pt-8">
          <p className="text-sm leading-relaxed text-eco-muted">
            Don&apos;t have an iPhone or want to save from desktop? You can always
            paste any link directly into the chat bar in your library.
          </p>
        </section>
      </div>
    </div>
  );
}

function Step({
  n,
  text,
  children,
}: {
  n: number;
  text: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-eco-border-light bg-eco-surface p-5">
      <div className="flex items-start gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-eco-tertiary font-display text-sm text-white">
          {n}
        </span>
        <p className="pt-0.5 text-sm font-medium text-eco-heading">{text}</p>
      </div>
      <div className="mt-4">{children}</div>
    </div>
  );
}

// ─── iOS mockups, built from styled divs (not screenshots) ────────────────────

function Phone({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[260px] overflow-hidden rounded-2xl border border-eco-border-light bg-stone-50 shadow-sm">
      <div className="border-b border-eco-border-light py-2">
        <div className="mx-auto h-1 w-9 rounded-full bg-stone-300" />
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  highlight,
  trailing,
}: {
  label: string;
  highlight?: boolean;
  trailing?: React.ReactNode;
}) {
  return (
    <div
      className={`flex items-center gap-3 px-4 py-2.5 text-sm ${
        highlight
          ? "rounded-lg bg-eco-tertiary/5 ring-1 ring-eco-tertiary/40"
          : ""
      }`}
    >
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs ${
          highlight
            ? "bg-eco-tertiary font-display text-white"
            : "bg-stone-200 text-stone-400"
        }`}
      >
        {highlight ? "G" : ""}
      </span>
      <span className={highlight ? "font-medium text-eco-tertiary" : "text-eco-muted"}>
        {label}
      </span>
      {trailing && <span className="ml-auto">{trailing}</span>}
    </div>
  );
}

function ShareSheetEditActions() {
  return (
    <Phone>
      <div className="space-y-0.5 p-2">
        <Row label="Copy" />
        <Row label="Add to Reading List" />
        <Row label="Add Bookmark" />
        <div className="mt-1 rounded-lg ring-1 ring-[#2D4B2D]/50">
          <div className="px-4 py-2.5 text-sm font-medium text-eco-tertiary">
            Edit Actions…
          </div>
        </div>
      </div>
    </Phone>
  );
}

function EditActionsList() {
  return (
    <Phone>
      <div className="px-4 py-2 text-xs font-medium text-stone-400">
        Favourites
      </div>
      <div className="space-y-0.5 px-2 pb-2">
        <Row label="Copy" />
        <Row label="Add to Reading List" />
      </div>
      <div className="px-4 py-2 text-xs font-medium text-stone-400">
        Suggestions
      </div>
      <div className="space-y-0.5 px-2 pb-3">
        <Row
          label="Save to Grimoire"
          highlight
          trailing={
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-eco-tertiary text-white">
              <Plus className="h-3.5 w-3.5" strokeWidth={3} />
            </span>
          }
        />
      </div>
    </Phone>
  );
}

function FavouritesList() {
  return (
    <Phone>
      <div className="px-4 py-2 text-xs font-medium text-stone-400">
        Favourites
      </div>
      <div className="space-y-0.5 px-2 pb-3">
        <Row
          label="Save to Grimoire"
          highlight
          trailing={
            <span className="flex flex-col gap-[3px]">
              <span className="h-0.5 w-4 rounded bg-stone-300" />
              <span className="h-0.5 w-4 rounded bg-stone-300" />
              <span className="h-0.5 w-4 rounded bg-stone-300" />
            </span>
          }
        />
        <Row label="Copy" />
        <Row label="Add to Reading List" />
      </div>
    </Phone>
  );
}

function ShareSheetQuickActions() {
  return (
    <Phone>
      <div className="flex items-end justify-around px-3 py-4">
        <QuickAction label="Save to Grimoire" highlight />
        <QuickAction label="Copy" />
        <QuickAction label="Reading List" />
      </div>
      <div className="border-t border-eco-border-light px-4 py-2.5 text-center text-sm font-medium text-eco-tertiary">
        Done
      </div>
    </Phone>
  );
}

function QuickAction({
  label,
  highlight,
}: {
  label: string;
  highlight?: boolean;
}) {
  return (
    <div className="flex w-16 flex-col items-center gap-1.5 text-center">
      <span
        className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg ${
          highlight
            ? "bg-eco-tertiary font-display text-white ring-2 ring-eco-tertiary/30"
            : "bg-stone-200 text-stone-400"
        }`}
      >
        {highlight ? "G" : <Check className="h-4 w-4" />}
      </span>
      <span className="text-[10px] leading-tight text-stone-500">{label}</span>
    </div>
  );
}
