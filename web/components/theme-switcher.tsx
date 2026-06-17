"use client";

import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { cn } from "@/lib/utils";

const options = [
  { value: "system", icon: Monitor, label: "System" },
  { value: "light", icon: Sun, label: "Light" },
  { value: "dark", icon: Moon, label: "Dark" },
] as const;

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <div
        className="h-9 rounded-lg border border-eco-border-muted bg-eco-input"
        aria-hidden
      />
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="px-1 font-sans text-label-md font-medium text-eco-foreground/75">
        Theme
      </p>
      <div
        className="inline-flex rounded-lg border border-eco-border-muted bg-eco-input p-0.5"
        role="radiogroup"
        aria-label="Color theme"
      >
        {options.map(({ value, icon: Icon, label }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className={cn(
              "flex flex-1 items-center justify-center rounded-md p-1.5 transition-colors duration-eco",
              theme === value
                ? "bg-eco-surface text-eco-primary shadow-eco-sm"
                : "text-eco-foreground/65 hover:bg-eco-hover hover:text-eco-foreground",
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        ))}
      </div>
    </div>
  );
}
