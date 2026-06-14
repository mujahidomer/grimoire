import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "muted" | "indigo";

const variants: Record<Variant, string> = {
  default: "bg-slate-100 text-slate-600",
  muted: "bg-transparent text-slate-400 border border-slate-200",
  indigo: "bg-indigo-50 text-indigo-700",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-sans text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
