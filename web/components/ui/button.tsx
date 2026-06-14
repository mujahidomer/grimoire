import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "outline";
type Size = "default" | "sm" | "icon";

const variants: Record<Variant, string> = {
  primary:
    "bg-eco-surface text-eco-on-surface hover:bg-white/90 border border-black/[0.12] focus-visible:ring-eco-primary",
  secondary:
    "bg-eco-primary text-eco-on-surface hover:bg-eco-tertiary hover:text-white focus-visible:ring-eco-primary",
  ghost:
    "text-eco-foreground hover:bg-eco-primary/10 focus-visible:ring-eco-border",
  outline:
    "border border-eco-border bg-white/60 text-eco-text hover:bg-eco-primary/10 focus-visible:ring-eco-border",
};

const sizes: Record<Size, string> = {
  default: "h-10 px-4 py-2 text-body-md",
  sm: "h-8 px-3 text-body-md",
  icon: "h-9 w-9",
};

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "default", ...props }, ref) => (
    <button
      ref={ref}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-surface font-sans font-medium transition-colors duration-eco focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  ),
);
Button.displayName = "Button";
