"use client";

import Link from "next/link";
import { Check, Circle, X } from "lucide-react";
import { useOnboarding } from "@/lib/onboarding";

function openChat() {
  window.dispatchEvent(new CustomEvent("grimoire:open-chat"));
}

function openSave() {
  window.dispatchEvent(new CustomEvent("grimoire:open-save"));
}

export function GetStartedBanner() {
  const {
    show,
    queryDone,
    saveDone,
    shortcutDone,
    dismissWelcome,
  } = useOnboarding();
  if (!show) return null;

  const allDone = queryDone && saveDone && shortcutDone;

  if (allDone) {
    return (
      <div className="relative mb-6 overflow-hidden rounded-2xl border border-stone-200 bg-white">
        <button
          type="button"
          onClick={dismissWelcome}
          className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-lg text-eco-foreground/55 transition-colors hover:bg-black/[0.04] hover:text-eco-foreground/85"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
        <div className="px-5 py-4 pr-12">
          <h2 className="font-display text-lg tracking-tight text-eco-heading">
            Welcome aboard
          </h2>
          <p className="mt-2 font-sans text-body-md leading-relaxed text-eco-on-surface">
            You&apos;re all set. We hope Grimoire helps you save what matters and
            find it again when you need it.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-6 overflow-hidden rounded-2xl border border-stone-200 bg-white">
      <div className="px-5 py-4">
        <h2 className="font-display text-lg tracking-tight text-eco-heading">
          Get started with Grimoire
        </h2>
        <ul className="mt-3 space-y-2">
          <ChecklistItem
            done={queryDone}
            label="Ask Grimoire a question"
            onClick={openChat}
          />
          <ChecklistItem
            done={saveDone}
            label="Save a link of your own"
            onClick={openSave}
          />
          <ChecklistItem
            done={shortcutDone}
            label="Set up the save shortcut"
            href="/onboarding/shortcut"
          />
        </ul>
      </div>
    </div>
  );
}

function ChecklistItem({
  done,
  label,
  onClick,
  href,
}: {
  done: boolean;
  label: string;
  onClick?: () => void;
  href?: string;
}) {
  const content = (
    <>
      {done ? (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#2D4B2D] text-white">
          <Check className="h-3 w-3" strokeWidth={3} />
        </span>
      ) : (
        <Circle className="h-5 w-5 text-stone-300" />
      )}
      <span
        className={`font-sans text-body-md ${
          done
            ? "text-eco-foreground/65 line-through"
            : "text-eco-primary underline decoration-eco-primary/30 underline-offset-2"
        }`}
      >
        {label}
      </span>
    </>
  );

  const itemClass =
    "flex items-center gap-2.5 rounded-lg -mx-1 px-1 py-0.5 transition-colors hover:bg-black/[0.03]";

  if (done) {
    return <li className="flex items-center gap-2.5">{content}</li>;
  }

  if (href) {
    return (
      <li>
        <Link href={href} className={itemClass}>
          {content}
        </Link>
      </li>
    );
  }

  if (onClick) {
    return (
      <li>
        <button type="button" onClick={onClick} className={`w-full text-left ${itemClass}`}>
          {content}
        </button>
      </li>
    );
  }

  return <li className="flex items-center gap-2.5">{content}</li>;
}
