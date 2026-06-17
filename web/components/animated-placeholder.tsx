"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

const CYCLE_MS = 4200;
const FADE_MS = 280;

interface AnimatedPlaceholderProps {
  suggestions: string[];
  visible: boolean;
  className?: string;
}

export function AnimatedPlaceholder({
  suggestions,
  visible,
  className,
}: AnimatedPlaceholderProps) {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    setIndex(0);
    setShown(true);
  }, [suggestions]);

  useEffect(() => {
    if (visible) setShown(true);
  }, [visible]);

  useEffect(() => {
    if (!visible || suggestions.length <= 1 || reducedMotion) return;

    let fadeTimer: ReturnType<typeof setTimeout> | undefined;
    const cycleTimer = setInterval(() => {
      setShown(false);
      fadeTimer = setTimeout(() => {
        setIndex((current) => (current + 1) % suggestions.length);
        setShown(true);
      }, FADE_MS);
    }, CYCLE_MS);

    return () => {
      clearInterval(cycleTimer);
      if (fadeTimer) clearTimeout(fadeTimer);
    };
  }, [visible, suggestions, reducedMotion]);

  if (!visible || suggestions.length === 0) return null;

  const text = suggestions[index] ?? suggestions[0];

  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 flex items-center truncate font-sans text-body-md text-eco-foreground/75 transition-all duration-300 ease-out motion-reduce:transition-none",
        shown ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0",
        className,
      )}
    >
      {text}
    </span>
  );
}
