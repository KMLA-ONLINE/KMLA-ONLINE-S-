import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  getCurrentLocale,
  readLanguagePreference,
  subscribeLanguage,
  writeLanguagePreference,
  type LanguagePreference,
  type Locale,
} from "~/shared/i18n/language";
import { translate, type TranslateParams } from "~/shared/i18n/translate";

/** prerender와 첫 hydration은 항상 한국어다. `root.tsx`의 빌드 렌더가 `localStorage`를 못 읽는다. */
function getServerLocale(): Locale {
  return "ko";
}

function getServerPreference(): LanguagePreference {
  return "ko";
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    subscribeLanguage,
    getCurrentLocale,
    getServerLocale,
  );
}

export function useLanguagePreference(): [
  LanguagePreference,
  (preference: LanguagePreference) => void,
] {
  const preference = useSyncExternalStore(
    subscribeLanguage,
    readLanguagePreference,
    getServerPreference,
  );
  return [preference, writeLanguagePreference];
}

export type Translate = (source: string, params?: TranslateParams) => string;

/** 한국어 원문을 넘기면 현재 언어의 문구를 준다. 언어가 바뀌면 다시 그려진다. */
export function useT(): Translate {
  const locale = useLocale();
  return useCallback(
    (source: string, params?: TranslateParams) =>
      translate(locale, source, params),
    [locale],
  );
}

/** `<html lang>`을 화면 언어에 맞춘다. Layout은 빌드 시 렌더되므로 effect로만 바꿀 수 있다. */
export function LanguageEffects() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);
  return null;
}
