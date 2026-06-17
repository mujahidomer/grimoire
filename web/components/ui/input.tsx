import * as React from "react";
import { cn } from "@/lib/utils";

export const Input = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full rounded-surface border border-eco-border bg-white/60 px-3 py-2 font-sans text-base text-eco-foreground backdrop-blur-eco placeholder:text-eco-text/60 focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary disabled:opacity-50 lg:text-body-md",
      className,
    )}
    {...props}
  />
));
Input.displayName = "Input";
