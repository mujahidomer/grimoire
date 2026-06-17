import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "default" | "muted" | "accent";

const variants: Record<Variant, string> = {
  default: "bg-eco-primary/10 text-eco-primary",
  muted: "bg-transparent text-eco-foreground/75 border border-eco-border/50",
  accent: "bg-eco-primary/20 text-eco-primary",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-surface px-2 py-0.5 font-sans text-label-md font-light",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
