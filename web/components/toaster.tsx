"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { subscribeToasts, type Toast } from "@/lib/toast";

const DISMISS_MS = 4000;

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    return subscribeToasts((toast) => {
      setToasts((current) => [...current, toast]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((t) => t.id !== toast.id));
      }, DISMISS_MS);
    });
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-24 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 shadow-eco-lg backdrop-blur-eco",
            toast.type === "success"
              ? "border-eco-border bg-white/95 text-eco-secondary"
              : "border-rose-200 bg-white/95 text-rose-700",
          )}
        >
          {toast.type === "success" ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-eco-primary" />
          ) : (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-500" />
          )}
          <p className="font-sans text-body-md">{toast.message}</p>
        </div>
      ))}
    </div>
  );
}
