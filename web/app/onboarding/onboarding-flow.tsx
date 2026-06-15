"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveUrl } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

const SHORTCUT_URL =
  "https://www.icloud.com/shortcuts/dd77a317524c429f9affb435899066a7";

type Segment = {
  id: string;
  label: string;
  problem: string;
};

// Personalised problem copy, keyed to the pills the user taps on screen 1.
const SEGMENTS: Segment[] = [
  {
    id: "ai",
    label: "AI tools & workflows",
    problem:
      "You save tools, prompts, and workflows constantly. But mid-project, when you need that thing you bookmarked two weeks ago — it's buried. Grimoire lets you ask: what have I saved about building AI agents?",
  },
  {
    id: "recipes",
    label: "Recipes & cooking",
    problem:
      "You've saved recipes from Instagram, YouTube, and blogs. But standing in the kitchen with 45 minutes and specific ingredients, you can't find the right one. Ask Grimoire: show me quick pasta recipes I've saved.",
  },
  {
    id: "islamic",
    label: "Islamic content & duas",
    problem:
      "You save hadith, duas, and lectures from different sources. But when you need a specific reference mid-conversation or before Friday, you're searching blindly. Ask Grimoire: what have I saved about sabr?",
  },
  {
    id: "finance",
    label: "Finance & investing",
    problem:
      "You save market analysis and strategy content constantly. But when a decision moment comes, you can't recall what you'd already researched. Ask Grimoire: what have I saved about dollar-cost averaging?",
  },
  {
    id: "fitness",
    label: "Fitness & health",
    problem:
      "You save workouts, nutrition advice, and routines from everywhere. But you can never find the right one when you actually want to train. Ask Grimoire: show me upper body workouts I've saved.",
  },
  {
    id: "research",
    label: "Research & articles",
    problem:
      "Your reading list is a graveyard. Dozens of articles saved, none retrievable when you need them. Ask Grimoire: summarise everything I've saved about a topic.",
  },
];

const MAX_PICKS = 2;
const TOTAL_STEPS = 4;

const greenBtn =
  "rounded-full bg-[#2D4B2D] px-6 py-3 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40";
const muted = "text-[#8A8780]";

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [picks, setPicks] = useState<string[]>([]);
  const [finishing, setFinishing] = useState(false);

  function togglePick(id: string) {
    setPicks((prev) => {
      if (prev.includes(id)) return prev.filter((p) => p !== id);
      if (prev.length >= MAX_PICKS) return prev;
      return [...prev, id];
    });
  }

  async function complete() {
    setFinishing(true);
    try {
      const supabase = createClient();
      await supabase.auth.updateUser({ data: { onboarding_complete: true } });
    } catch {
      // Even if the flag write fails, don't trap the user in onboarding.
    }
    router.refresh();
    router.push("/");
  }

  const selected = SEGMENTS.filter((s) => picks.includes(s.id));

  return (
    <div className="min-h-screen bg-[#EEEAE4] text-[#1C1C1A]">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col px-6 py-10">
        {/* Progress dots */}
        <div className="flex justify-center gap-2 pb-12">
          {Array.from({ length: TOTAL_STEPS }).map((_, i) => (
            <span
              key={i}
              className={`h-2 w-2 rounded-full transition-colors ${
                i <= step ? "bg-[#2D4B2D]" : "bg-stone-300"
              }`}
            />
          ))}
        </div>

        <div className="flex flex-1 flex-col">
          {step === 0 && (
            <Step1
              picks={picks}
              onToggle={togglePick}
              onContinue={() => setStep(1)}
            />
          )}
          {step === 1 && (
            <Step2 selected={selected} onContinue={() => setStep(2)} />
          )}
          {step === 2 && (
            <Step3 onContinue={() => setStep(3)} onSkip={() => setStep(3)} />
          )}
          {step === 3 && (
            <Step4 finishing={finishing} onComplete={complete} />
          )}
        </div>
      </div>
    </div>
  );
}

function Step1({
  picks,
  onToggle,
  onContinue,
}: {
  picks: string[];
  onToggle: (id: string) => void;
  onContinue: () => void;
}) {
  return (
    <div>
      <h1 className="font-display text-3xl leading-tight tracking-tight">
        What kind of things do you save?
      </h1>
      <p className={`mt-3 text-sm leading-relaxed ${muted}`}>
        We&apos;ll show you how Grimoire helps people like you. Pick up to two.
      </p>

      <div className="mt-8 flex flex-wrap gap-3">
        {SEGMENTS.map((s) => {
          const active = picks.includes(s.id);
          const disabled = !active && picks.length >= MAX_PICKS;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onToggle(s.id)}
              disabled={disabled}
              className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                active
                  ? "border-[#2D4B2D] bg-[#2D4B2D] text-white"
                  : "border-stone-300 bg-white text-[#1C1C1A] hover:border-stone-400"
              } ${disabled ? "cursor-not-allowed opacity-40" : ""}`}
            >
              {s.label}
            </button>
          );
        })}
      </div>

      <div className="mt-10">
        <button
          type="button"
          className={greenBtn}
          disabled={picks.length === 0}
          onClick={onContinue}
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function Step2({
  selected,
  onContinue,
}: {
  selected: Segment[];
  onContinue: () => void;
}) {
  return (
    <div>
      <h1 className="font-display text-3xl leading-tight tracking-tight">
        Sound familiar?
      </h1>
      <div className="mt-8 space-y-6">
        {selected.map((s) => (
          <div
            key={s.id}
            className="rounded-2xl border border-stone-200 bg-white p-6"
          >
            <p className="text-sm leading-relaxed text-[#1C1C1A]">
              {s.problem}
            </p>
          </div>
        ))}
      </div>
      <div className="mt-10">
        <button type="button" className={greenBtn} onClick={onContinue}>
          That&apos;s exactly it →
        </button>
      </div>
    </div>
  );
}

function Step3({
  onContinue,
  onSkip,
}: {
  onContinue: () => void;
  onSkip: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">
        <h1 className="font-display text-3xl leading-tight tracking-tight">
          Set up saving in 30 seconds
        </h1>
        <p className={`mt-3 text-sm leading-relaxed ${muted}`}>
          Grimoire works through an iOS Shortcut. Tap below to add it, then share
          any link to it from any app.
        </p>

        <div className="mt-8">
          <a
            href={SHORTCUT_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={greenBtn + " inline-block"}
          >
            Add Shortcut to iPhone
          </a>
        </div>

        <p className={`mt-6 text-sm ${muted}`}>
          Already added it?{" "}
          <button
            type="button"
            onClick={onContinue}
            className="font-medium text-[#2D4B2D] hover:underline"
          >
            Continue
          </button>
        </p>
      </div>

      <div className="pt-10">
        <button
          type="button"
          onClick={onSkip}
          className={`text-sm ${muted} hover:underline`}
        >
          I&apos;ll do this later
        </button>
      </div>
    </div>
  );
}

function Step4({
  finishing,
  onComplete,
}: {
  finishing: boolean;
  onComplete: () => void;
}) {
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (!value) return;
    setError(null);
    setSaving(true);
    try {
      await saveUrl(value);
      await onComplete();
    } catch (err) {
      setSaving(false);
      setError(err instanceof Error ? err.message : "Couldn't save that link.");
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1">
        <h1 className="font-display text-3xl leading-tight tracking-tight">
          Save something now
        </h1>
        <p className={`mt-3 text-sm leading-relaxed ${muted}`}>
          Share any link — a YouTube video, article, Instagram post, recipe — to
          the Grimoire shortcut you just added.
        </p>

        {/* Static iOS share-sheet illustration */}
        <ShareSheetMockup />

        <form onSubmit={handleSave} className="mt-8 space-y-3">
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Or paste a link here"
            className="w-full rounded-xl border border-stone-300 bg-white px-4 py-3 text-sm text-[#1C1C1A] outline-none placeholder:text-[#8A8780] focus:border-[#2D4B2D]"
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button
            type="submit"
            className={greenBtn}
            disabled={saving || finishing || url.trim().length === 0}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </form>
      </div>

      <div className="pt-10">
        <button
          type="button"
          onClick={onComplete}
          disabled={saving || finishing}
          className={`text-sm ${muted} hover:underline disabled:opacity-40`}
        >
          Go to my library →
        </button>
      </div>
    </div>
  );
}

// Simple, drawn-not-screenshotted approximation of the iOS share sheet with the
// Grimoire action highlighted in the brand green.
function ShareSheetMockup() {
  const rows = ["Copy", "Add to Reading List", "Save to Files"];
  return (
    <div className="mt-8 overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm">
      <div className="border-b border-stone-100 px-5 py-4">
        <div className="mx-auto h-1 w-9 rounded-full bg-stone-300" />
        <p className="mt-3 text-xs font-medium text-[#8A8780]">
          Share sheet
        </p>
      </div>
      <ul className="divide-y divide-stone-100">
        <li className="flex items-center gap-3 bg-[#2D4B2D]/5 px-5 py-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#2D4B2D] font-display text-sm text-white">
            G
          </span>
          <span className="text-sm font-medium text-[#2D4B2D]">
            Grimoire
          </span>
          <span className="ml-auto text-xs text-[#2D4B2D]">Tap this</span>
        </li>
        {rows.map((r) => (
          <li
            key={r}
            className="flex items-center gap-3 px-5 py-3 text-[#8A8780]"
          >
            <span className="h-8 w-8 rounded-lg bg-stone-100" />
            <span className="text-sm">{r}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
