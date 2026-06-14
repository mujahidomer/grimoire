import type { TakeawayValue } from "@/lib/types";

const INGREDIENT_KEY = /^ingredients?$/i;
const STEPS_KEY = /^(cooking_)?steps?$|^cooking_steps$|^instructions?$/i;
const PASSAGES_KEY = /^passages$/i;
const ARABIC_KEY = /^arabic(_text)?$/i;

function isEmptyTakeaways(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

function isPlainObject(v: unknown): v is Record<string, TakeawayValue> {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

/** True when a passage object carries verbatim Arabic sacred text. */
export function isSacredPassage(obj: unknown): obj is Record<string, TakeawayValue> {
  if (!isPlainObject(obj)) return false;
  const arabic = obj.arabic ?? obj.arabic_text;
  return typeof arabic === "string" && arabic.trim() !== "";
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

/** True when takeaways include structured du'a / hadith / verse passages. */
export function isSacredTextTakeaways(value: TakeawayValue): boolean {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const passages = (value as Record<string, TakeawayValue>).passages;
  if (!Array.isArray(passages) || passages.length === 0) return false;
  return passages.some(isSacredPassage);
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

/** Sacred text sections: passages first, then surrounding context. */
export function orderSacredTextEntries(
  obj: Record<string, TakeawayValue>,
): [string, TakeawayValue][] {
  const entries = Object.entries(obj).filter(([, v]) => !isEmptyTakeaways(v));
  const passages = entries.filter(([k]) => PASSAGES_KEY.test(k));
  const rest = entries.filter(([k]) => !PASSAGES_KEY.test(k));
  return [...passages, ...rest];
}

export function isRecipeStepsKey(key: string): boolean {
  return STEPS_KEY.test(key);
}

export function isRecipeIngredientsKey(key: string): boolean {
  return INGREDIENT_KEY.test(key);
}

export function isPassagesKey(key: string): boolean {
  return PASSAGES_KEY.test(key);
}

export function isArabicTextKey(key: string): boolean {
  return ARABIC_KEY.test(key);
}
