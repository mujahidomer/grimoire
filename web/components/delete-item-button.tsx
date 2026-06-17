"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, X } from "lucide-react";
import { deleteItem } from "@/lib/api";
import { showToast } from "@/lib/toast";
import { Button } from "@/components/ui/button";

export function DeleteItemButton({
  itemId,
  itemTitle,
}: {
  itemId: string;
  itemTitle: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function confirmDelete() {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteItem(itemId);
      showToast(
        itemTitle ? `Deleted "${itemTitle}"` : "Link removed from your library",
        "success",
      );
      window.dispatchEvent(new CustomEvent("grimoire:refresh"));
      router.push("/");
    } catch (err) {
      showToast(
        err instanceof Error && err.message
          ? err.message
          : "Couldn't delete that link. Try again.",
        "error",
      );
    } finally {
      setDeleting(false);
      setOpen(false);
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
      >
        <Trash2 className="h-4 w-4" />
        Delete
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-eco-secondary/30 p-4"
          onClick={() => !deleting && setOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-card border border-eco-border bg-white/90 p-5 shadow-eco-lg backdrop-blur-eco"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-sans text-body-md font-semibold text-eco-secondary">
                  Delete this saved link?
                </h3>
                <p className="mt-2 font-sans text-body-md text-eco-foreground/85">
                  {itemTitle
                    ? `"${itemTitle}" will be permanently removed from your library.`
                    : "This link will be permanently removed from your library."}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setOpen(false)}
                disabled={deleting}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={deleting}
              >
                Cancel
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={confirmDelete}
                disabled={deleting}
                className="bg-rose-600 hover:bg-rose-700"
              >
                {deleting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
