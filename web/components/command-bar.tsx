"use client";

import { useState } from "react";
import { Loader2, MessageCircle, Plus } from "lucide-react";
import { saveUrl } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { looksLikeUrl } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface CommandBarProps {
  onAsk: (question: string) => void;
  onOpenChat: () => void;
  asking?: boolean;
  onSaved?: () => void;
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
      onSaved?.();
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
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center px-6 pb-6">
      <div className="pointer-events-auto w-full max-w-2xl">
        {saveOpen ? (
          <form
            onSubmit={handleSave}
            className="flex items-center gap-2 rounded-2xl border border-black/[0.08] bg-white px-3 py-2 shadow-eco-lg"
          >
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="Paste a link to save…"
              autoFocus
              className="h-9 flex-1 bg-transparent font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/40 focus:outline-none"
            />
            <Button type="submit" size="sm" disabled={saving || !url.trim()}>
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                "Save"
              )}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={closeSaveMode}
            >
              Cancel
            </Button>
          </form>
        ) : (
          <form
            onSubmit={handleAsk}
            className="flex items-center gap-2 rounded-full border border-black/[0.08] bg-white/95 px-4 py-2 shadow-eco-lg backdrop-blur-eco"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onPaste={handlePaste}
              placeholder="Ask anything"
              className="h-9 min-w-0 flex-1 bg-transparent font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/40 focus:outline-none"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => openSaveMode()}
              className="shrink-0 rounded-full"
            >
              <Plus className="h-3.5 w-3.5" />
              Save link
            </Button>
            <button
              type="button"
              onClick={onOpenChat}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-eco-border-light bg-eco-surface px-3 py-1.5 font-sans text-label-md font-medium text-eco-on-surface transition-colors hover:bg-black/[0.03]"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              Ask anything
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
