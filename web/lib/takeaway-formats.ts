import type { TakeawayValue } from "@/lib/types";

const INGREDIENT_KEY = /^ingredients?$/i;
const STEPS_KEY = /^(cooking_)?steps?$|^cooking_steps$|^instructions?$/i;

function isEmptyTakeaways(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

/** True when this item should use the recipe layout (ingredients → steps → rest). */
export function isRecipeTakeaways(
  value: TakeawayValue,
  category?: string,
): boolean {
  if (category !== "Food & Cooking") return false;
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return keys.some((k) => STEPS_KEY.test(k) || INGREDIENT_KEY.test(k));
}

/** Recipe sections always render in this order; everything else keeps source order. */
export function orderRecipeEntries(
  obj: Record<string, TakeawayValue>,
): [string, TakeawayValue][] {
  const entries = Object.entries(obj).filter(([, v]) => !isEmptyTakeaways(v));
  const ingredients = entries.filter(([k]) => INGREDIENT_KEY.test(k));
  const steps = entries.filter(([k]) => STEPS_KEY.test(k));
  const rest = entries.filter(
    ([k]) => !INGREDIENT_KEY.test(k) && !STEPS_KEY.test(k),
  );
  return [...ingredients, ...steps, ...rest];
}

export function isRecipeStepsKey(key: string): boolean {
  return STEPS_KEY.test(key);
}

export function isRecipeIngredientsKey(key: string): boolean {
  return INGREDIENT_KEY.test(key);
}
