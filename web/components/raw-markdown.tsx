"use client";

import { useState } from "react";
import { Check, Copy, Loader2, X } from "lucide-react";
import { fetchItemMarkdown } from "@/lib/api";
import { Button } from "@/components/ui/button";

export function RawMarkdownButton({ itemId }: { itemId: string }) {
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  async function openModal() {
    setOpen(true);
    if (markdown === null) {
      setLoading(true);
      try {
        setMarkdown(await fetchItemMarkdown(itemId));
      } catch {
        setMarkdown("Couldn't load the raw markdown for this item.");
      } finally {
        setLoading(false);
      }
    }
  }

  async function copy() {
    if (!markdown) return;
    await navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={openModal}>
        View raw markdown
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-slate-200 bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
              <span className="font-sans text-sm font-semibold text-slate-900">
                Raw markdown
              </span>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={copy}
                  disabled={!markdown || loading}
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4" /> Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" /> Copy
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="overflow-auto p-5 scrollbar-thin">
              {loading ? (
                <div className="flex justify-center py-12 text-slate-400">
                  <Loader2 className="h-5 w-5 animate-spin" />
                </div>
              ) : (
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-slate-700">
                  {markdown}
                </pre>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
