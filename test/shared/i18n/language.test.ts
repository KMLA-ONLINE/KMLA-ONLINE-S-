import { afterEach, describe, expect, it } from "vitest";

import {
  LANGUAGE_STORAGE_KEY,
  getCurrentLocale,
  readLanguagePreference,
  resolveLocale,
  subscribeLanguage,
  writeLanguagePreference,
} from "~/shared/i18n/language";

afterEach(() => window.localStorage.clear());

describe("language preference", () => {
  it("defaults to Korean when nothing is stored", () => {
    expect(readLanguagePreference()).toBe("ko");
    expect(getCurrentLocale()).toBe("ko");
  });

  it("ignores unknown stored values", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "fr");
    expect(readLanguagePreference()).toBe("ko");
  });

  it("persists the choice and notifies same-tab subscribers", () => {
    let calls = 0;
    const unsubscribe = subscribeLanguage(() => {
      calls += 1;
    });

    writeLanguagePreference("en");

    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe("en");
    expect(readLanguagePreference()).toBe("en");
    expect(getCurrentLocale()).toBe("en");
    expect(calls).toBe(1);
    unsubscribe();
  });
});

describe("resolveLocale", () => {
  it("maps explicit choices directly", () => {
    expect(resolveLocale("ko", "en-US")).toBe("ko");
    expect(resolveLocale("en", "ko-KR")).toBe("en");
  });

  it("follows the device language for system, falling back to Korean", () => {
    expect(resolveLocale("system", "en-GB")).toBe("en");
    expect(resolveLocale("system", "ko")).toBe("ko");
    expect(resolveLocale("system", "ja-JP")).toBe("ko");
    expect(resolveLocale("system", undefined)).toBe("ko");
  });
});
