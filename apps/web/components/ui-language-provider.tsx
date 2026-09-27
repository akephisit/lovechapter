"use client";

import { createContext, useContext, type ReactNode } from "react";

import { getUiCopy } from "../lib/ui-copy";
import type { UiLanguage } from "../lib/ui-language";

const UiLanguageContext = createContext<UiLanguage>("en");

export function UiLanguageProvider({
  language,
  children,
}: {
  language: UiLanguage;
  children: ReactNode;
}) {
  return (
    <UiLanguageContext.Provider value={language}>
      {children}
    </UiLanguageContext.Provider>
  );
}

export function useUiLanguage(): UiLanguage {
  return useContext(UiLanguageContext);
}

export function useUiCopy() {
  return getUiCopy(useUiLanguage());
}
