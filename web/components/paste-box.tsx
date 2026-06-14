"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus } from "lucide-react";
import { saveUrl } from "@/lib/api";
import { useSaveLinkProgress } from "@/lib/save-link-progress";
import { SaveLinkProgress } from "@/components/save-link-progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; id: string; title: string }
  | { kind: "error"; message: string };

export function PasteBox({ onSaved }: { onSaved: () => void }) {
  const [url, setUrl] = useState("");
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const saving = status.kind === "saving";
  const { stepIndex } = useSaveLinkProgress(saving);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!trimmed || status.kind === "saving") return;
    setStatus({ kind: "saving" });
    try {
      const res = await saveUrl(trimmed);
      setStatus({ kind: "saved", id: res.id!, title: res.title ?? "Saved item" });
      setUrl("");
      onSaved();
    } catch (err) {
      setStatus({
        kind: "error",
        message:
          err instanceof Error && err.message
            ? err.message
            : "Couldn't save that link. Check the URL and try again.",
      });
    }
  }

  return (
    <div className="w-full">
      <form onSubmit={handleSave} className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="url"
          inputMode="url"
          placeholder="Paste a link to save it to your library…"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={status.kind === "saving"}
          className="flex-1"
        />
        <Button type="submit" disabled={status.kind === "saving" || !url.trim()}>
          {status.kind === "saving" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Save
            </>
          )}
        </Button>
      </form>

      {status.kind === "saving" && <SaveLinkProgress stepIndex={stepIndex} />}
      {status.kind === "saved" && (
        <p className="mt-2 font-sans text-body-md text-eco-text">
          Saved —{" "}
          <Link
            href={`/item/${status.id}`}
            className="font-medium text-eco-secondary transition-colors duration-eco hover:text-eco-primary hover:underline"
          >
            {status.title}
          </Link>
        </p>
      )}
      {status.kind === "error" && (
        <p className="mt-2 font-sans text-body-md text-rose-600">{status.message}</p>
      )}
    </div>
  );
}
