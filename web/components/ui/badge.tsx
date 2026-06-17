import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "muted" | "accent";

const variants: Record<Variant, string> = {
  default:
    "bg-[var(--eco-badge-bg)] text-[var(--eco-badge-text)] ring-1 ring-inset ring-[var(--eco-badge-border)]",
  muted:
    "bg-eco-hover text-eco-foreground/70 ring-1 ring-inset ring-eco-border-subtle/50",
  accent:
    "bg-eco-primary/15 text-eco-tertiary/90 ring-1 ring-inset ring-eco-primary/20",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-sans text-label-md font-normal",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
