"use client";

import { useState } from "react";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import { saveUrl } from "@/lib/api";
import { useSaveLinkProgress } from "@/lib/save-link-progress";
import { showToast } from "@/lib/toast";
import { useSuggestedQuestions } from "@/lib/use-suggested-questions";
import { looksLikeUrl } from "@/lib/utils";
import { AnimatedPlaceholder } from "@/components/animated-placeholder";
import { SaveLinkProgress } from "@/components/save-link-progress";
import { Button } from "@/components/ui/button";

interface CommandBarProps {
  onAsk: (question: string) => void;
  onOpenChat: () => void;
  asking?: boolean;
  onSaved?: (detail: { savedIds: string[] }) => void;
}

export function CommandBar({
  onAsk,
  onOpenChat,
  asking,
  onSaved,
}: CommandBarProps) {
  const [input, setInput] = useState("");
  const [saveOpen, setSaveOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const { stepIndex } = useSaveLinkProgress(saving);
  const suggestedQuestions = useSuggestedQuestions();

  function openSaveMode(initialUrl = "") {
    setSaveOpen(true);
    setUrl(initialUrl);
    setInput("");
  }

  function closeSaveMode() {
    setSaveOpen(false);
    setUrl("");
  }

  function handleAsk(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || asking) return;
    if (looksLikeUrl(q)) {
      openSaveMode(q);
      return;
    }
    onAsk(q);
    setInput("");
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text").trim();
    if (!looksLikeUrl(pasted)) return;
    e.preventDefault();
    openSaveMode(pasted);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const res = await saveUrl(trimmed);
      closeSaveMode();
      const savedIds =
        res.items?.map((item) => item.id).filter(Boolean) ??
        (res.id ? [res.id] : []);
      onSaved?.({ savedIds });
      showToast(
        res.title ? `Saved "${res.title}"` : "Link saved to your library",
        "success",
      );
    } catch (err) {
      showToast(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save that link. Check the URL and try again.",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:absolute lg:z-40 lg:px-6 lg:pb-6">
      <div className="pointer-events-auto w-full max-w-2xl">
        {saveOpen ? (
          <form
            onSubmit={handleSave}
            className="rounded-2xl border border-black/[0.08] bg-white px-3 py-2 shadow-eco-lg"
          >
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Paste a link to save…"
                autoFocus
                disabled={saving}
                aria-busy={saving}
                className="h-9 min-w-0 flex-1 basis-full bg-transparent font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/40 focus:outline-none disabled:opacity-60 sm:basis-auto"
              />
              <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                <Button type="submit" size="sm" disabled={saving || !url.trim()}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Saving…
                    </>
                  ) : (
                    "Save link"
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={closeSaveMode}
                  disabled={saving}
                >
                  Cancel
                </Button>
              </div>
            </div>
            {saving && <SaveLinkProgress stepIndex={stepIndex} />}
          </form>
        ) : (
          <div className="command-bar-glow">
            <form
              onSubmit={handleAsk}
              className="relative flex items-center gap-1.5 rounded-full bg-white px-3 py-2 shadow-[0_1px_2px_rgba(0,0,0,0.04)] sm:gap-2 sm:px-4"
            >
              <div className="relative min-w-0 flex-1">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onPaste={handlePaste}
                  placeholder={suggestedQuestions[0]}
                  aria-label="Ask a question about your library"
                  className="relative z-0 h-9 w-full bg-transparent font-sans text-body-md text-eco-foreground placeholder:text-transparent focus:outline-none"
                />
                <AnimatedPlaceholder
                  suggestions={suggestedQuestions}
                  visible={!input.trim()}
                  className="z-10"
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => openSaveMode()}
                className="shrink-0 rounded-full px-2.5 sm:px-3"
                aria-label="Save link"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Save link</span>
              </Button>
              <button
                type="button"
                onClick={onOpenChat}
                className="hidden shrink-0 items-center gap-1.5 rounded-full border border-eco-border-light bg-eco-surface px-3 py-1.5 font-sans text-label-md font-medium text-eco-on-surface transition-colors hover:bg-black/[0.03] sm:inline-flex"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                Ask anything
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}
