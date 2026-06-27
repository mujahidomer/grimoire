"use client";

import { DAILY_LIMIT, type ChatUsageState } from "@/lib/use-chat-usage";

// Usage bar shown above the chat input:
//   ⚡ 12 / 20 queries used  ·  Resets in 6h
// with a thin indigo progress bar underneath. Text turns amber at 80%+ usage
// and red (with a "Limit reached" message) once the daily allowance is spent.
export function ChatUsageBar({
  state,
  isDeep,
}: {
  state: ChatUsageState;
  isDeep: boolean;
}) {
  const { used, pct, atLimit, nearLimit, resetLabel, unlimited } = state;

  if (unlimited) return null;

  const textColor = atLimit
    ? "text-red-600"
    : nearLimit
      ? "text-amber-600"
      : "text-eco-foreground/65";

  return (
    <div className="px-1 pb-2">
      <div className={`flex items-center justify-between font-sans text-label-md ${textColor}`}>
        <span>
          {atLimit ? (
            `Limit reached · ${resetLabel}`
          ) : (
            <>⚡ {used} / {DAILY_LIMIT} queries used · {resetLabel}</>
          )}
        </span>
        {isDeep && (
          <span className="text-indigo-600">Deep Dive · 3 credits</span>
        )}
      </div>
      <div className="mt-1 h-[2px] w-full overflow-hidden rounded-full bg-eco-border/40">
        <div
          className="h-full bg-indigo-500 transition-[width] duration-300"
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
    </div>
  );
}

// Quick Answer / Deep Dive pill toggle. Quick Answer is selected by default;
// the active pill is highlighted in indigo.
export function DeepDiveToggle({
  isDeep,
  onChange,
  disabled,
}: {
  isDeep: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
}) {
  const base =
    "inline-flex items-center gap-1 rounded-full px-3 py-1 font-sans text-label-md transition-colors disabled:opacity-50";
  const active = "bg-indigo-500 text-white";
  const inactive =
    "border border-eco-border bg-eco-surface text-eco-foreground/70 hover:bg-eco-surface-raised";

  return (
    <div className="flex items-center gap-2 px-1 pb-2">
      <button
        type="button"
        disabled={disabled}
        aria-pressed={!isDeep}
        onClick={() => onChange(false)}
        className={`${base} ${!isDeep ? active : inactive}`}
      >
        ⚡ Quick Answer
      </button>
      <button
        type="button"
        disabled={disabled}
        aria-pressed={isDeep}
        onClick={() => onChange(true)}
        className={`${base} ${isDeep ? active : inactive}`}
      >
        🔍 Deep Dive · 3 credits
      </button>
    </div>
  );
}
