import { en, type Dictionary } from "./en";
import { he } from "./he";

export const LOCALES = ["he", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "he";

const DICTIONARIES: Record<Locale, Dictionary> = { he, en };

export function isLocale(v: string | undefined | null): v is Locale {
  return v === "he" || v === "en";
}

export function getDictionary(locale: Locale): Dictionary {
  return DICTIONARIES[locale];
}

/** Replace {name} placeholders. */
export function fmt(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
}

/** Look up a key in a string map, falling back to the key itself (never crash on a new code). */
export function lookup(map: Record<string, string>, key: string): string {
  return map[key] ?? key;
}

export type { Dictionary };
