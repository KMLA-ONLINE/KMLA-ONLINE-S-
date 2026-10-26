import { afterEach, describe, expect, it, vi } from "vitest";

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

describe("snapshot caching", () => {
  it("serves subscribed reads from memory and refreshes after a change", () => {
    const unsubscribe = subscribeLanguage(vi.fn());
    const spy = vi.spyOn(Storage.prototype, "getItem");

    readLanguagePreference();
    readLanguagePreference();
    getCurrentLocale();
    expect(spy).toHaveBeenCalledTimes(1);

    writeLanguagePreference("en");
    expect(readLanguagePreference()).toBe("en");

    // 다른 탭의 변경은 storage 이벤트로 온다.
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "system");
    window.dispatchEvent(new Event("storage"));
    expect(readLanguagePreference()).toBe("system");

    unsubscribe();
    spy.mockRestore();
  });

  it("reads storage fresh once nobody subscribes", () => {
    const unsubscribe = subscribeLanguage(vi.fn());
    readLanguagePreference();
    unsubscribe();

    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    expect(readLanguagePreference()).toBe("en");
  });
});
