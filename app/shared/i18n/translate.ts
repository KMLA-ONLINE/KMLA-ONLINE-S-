import { en } from "~/shared/i18n/en";
import type { Locale } from "~/shared/i18n/language";

export type TranslateParams = Record<string, string | number>;

/**
 * 한국어 원문이 곧 키다. 영어 사전에 없으면 한국어가 그대로 나가므로 번역이 빠져도 화면은
 * 살아 있고, 한국어 코드는 `t()`로 감싸는 것 말고 바뀌지 않는다.
 *
 * 자리표시자는 `{name}`. 영어 복수형은 `{count|comment|comments}`처럼 값 이름 뒤에 단수·복수를
 * 적으면 `params.count === 1`일 때 앞 것을 고른다. 한국어 원문에는 복수형이 없다.
 */
export function translate(
  locale: Locale,
  source: string,
  params?: TranslateParams,
): string {
  const template = locale === "en" ? (en[source] ?? source) : source;
  if (!params) return template;

  return template.replace(
    /\{(\w+)(?:\|([^|}]*)\|([^}]*))?\}/g,
    (match, name: string, one?: string, other?: string) => {
      const value = params[name];
      if (value === undefined) return match;
      if (one !== undefined && other !== undefined)
        return value === 1 ? one : other;
      return String(value);
    },
  );
}
