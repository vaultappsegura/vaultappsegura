import type { Locale, Lang } from "./types";
export type { Locale, Lang };

import { es } from "./es";
import { en } from "./en";
import { zh } from "./zh";
import { hi } from "./hi";
import { ar } from "./ar";
import { fr } from "./fr";
import { ru } from "./ru";
import { pt } from "./pt";
import { bn } from "./bn";
import { fa } from "./fa";
import { de } from "./de";
import { ja } from "./ja";
import { he } from "./he";

export const locales: Record<Lang, Locale> = {
  es, en, zh, hi, ar, fr, ru, pt, bn, fa, de, ja, he,
};

export const LANG_LABELS: Record<Lang, string> = {
  es: "Español",
  en: "English",
  zh: "中文 (普通话)",
  hi: "हिन्दी",
  ar: "العربية",
  fr: "Français",
  ru: "Русский",
  pt: "Português",
  bn: "বাংলা",
  fa: "فارسی",
  de: "Deutsch",
  ja: "日本語",
  he: "עברית",
};
