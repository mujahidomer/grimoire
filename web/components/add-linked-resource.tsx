"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";
import type { LinkedResource } from "@/lib/types";
import { addLinkedResource } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddLinkedResource({
  itemId,
  onAdded,
}: {
  itemId: string;
  onAdded: (resources: LinkedResource[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const resources = await addLinkedResource(itemId, trimmed);
      onAdded(resources);
      setUrl("");
      setOpen(false);
    } catch {
      setError("Couldn't add that link. Check the URL and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        Add linked resource
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row sm:items-center">
      <Input
        type="url"
        inputMode="url"
        autoFocus
        placeholder="https://…"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        disabled={submitting}
        className="sm:w-80"
      />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={submitting || !url.trim()}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Adding…
            </>
          ) : (
            "Add"
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={submitting}
        >
          Cancel
        </Button>
      </div>
      {error && (
        <p className="font-sans text-sm text-rose-600 sm:ml-2">{error}</p>
      )}
    </form>
  );
}
