import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { locales, type Locale, type Lang } from "./locales";


export type { Lang };

interface LangCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: keyof Locale) => string;
  dir: "ltr" | "rtl";
}

const RTL_LANGS: Lang[] = ["ar", "he", "fa"];

const Ctx = createContext<LangCtx>({
  lang: "es",
  setLang: () => {},
  t: (k) => k as string,
  dir: "ltr",
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => {
    const saved = localStorage.getItem("app_lang");
    return (saved as Lang) || "es";
  });

  const dir: "ltr" | "rtl" = RTL_LANGS.includes(lang) ? "rtl" : "ltr";

  function setLang(l: Lang) {
    setLangState(l);
    localStorage.setItem("app_lang", l);
  }

  useEffect(() => {
    document.documentElement.setAttribute("dir", dir);
    document.documentElement.setAttribute("lang", lang);
  }, [lang, dir]);

  function t(key: keyof Locale): string {
    const locale = locales[lang];
    return (locale as any)[key] ?? (locales["es"] as any)[key] ?? key;
  }

  return <Ctx.Provider value={{ lang, setLang, t, dir }}>{children}</Ctx.Provider>;
}

export function useT() {
  return useContext(Ctx);
}
