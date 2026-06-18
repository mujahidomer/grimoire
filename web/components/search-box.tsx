"use client";

import { useEffect, useRef, type RefObject } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export function SearchBox({
  value,
  onChange,
  variant = "default",
  className,
  autoFocus = false,
  inputRef,
}: {
  value: string;
  onChange: (v: string) => void;
  variant?: "default" | "sidebar";
  className?: string;
  autoFocus?: boolean;
  inputRef?: RefObject<HTMLInputElement>;
}) {
  const isSidebar = variant === "sidebar";

  return (
    <div className={cn("relative w-full max-w-sm", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-eco-foreground/55" />
      <input
        ref={inputRef}
        type="search"
        placeholder="Search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        className={cn(
          "h-9 w-full rounded-lg border pl-9 font-sans text-body-md text-eco-foreground placeholder:text-eco-foreground/55 focus-visible:border-eco-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-eco-primary",
          isSidebar
            ? "border-eco-border-muted bg-eco-input-solid pr-12"
            : "border-eco-border bg-eco-input pr-3 backdrop-blur-eco",
        )}
      />
      {isSidebar && (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-eco-border-muted bg-eco-kbd-bg px-1.5 py-0.5 font-sans text-[10px] text-eco-foreground/55">
          ⌘K
        </kbd>
      )}
    </div>
  );
}
