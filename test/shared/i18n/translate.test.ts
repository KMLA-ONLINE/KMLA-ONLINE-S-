import { describe, expect, it } from "vitest";

import { en } from "~/shared/i18n/en";
import { auth } from "~/shared/i18n/en/auth";
import { common } from "~/shared/i18n/en/common";
import { messaging } from "~/shared/i18n/en/messaging";
import { notifications } from "~/shared/i18n/en/notifications";
import { posts } from "~/shared/i18n/en/posts";
import { posts_sub } from "~/shared/i18n/en/posts-sub";
import { settings } from "~/shared/i18n/en/settings";
import { shell } from "~/shared/i18n/en/shell";
import { translate } from "~/shared/i18n/translate";

describe("translate", () => {
  it("returns the Korean source untouched for ko", () => {
    expect(translate("ko", "실험실")).toBe("실험실");
  });

  it("looks the Korean source up in the English dictionary", () => {
    expect(translate("en", "실험실")).toBe("Lab");
  });

  it("falls back to the Korean source when English is missing", () => {
    expect(translate("en", "번역되지 않은 문장")).toBe("번역되지 않은 문장");
  });

  it("interpolates named params in both languages", () => {
    expect(translate("ko", "{name}님", { name: "민기" })).toBe("민기님");
    expect(translate("en", "{count}분전", { count: 3 })).toBe("3 min ago");
  });

  it("picks the English plural form by count", () => {
    expect(translate("en", "댓글 {count}개", { count: 1 })).toBe("1 comment");
    expect(translate("en", "댓글 {count}개", { count: 2 })).toBe("2 comments");
  });
});

describe("english dictionary", () => {
  it("translates a source the same way in every area file", () => {
    const areas = {
      common,
      shell,
      auth,
      settings,
      notifications,
      posts,
      posts_sub,
      messaging,
    };
    const seen = new Map<string, [string, string]>();
    for (const [area, dictionary] of Object.entries(areas)) {
      for (const [source, target] of Object.entries(dictionary)) {
        const previous = seen.get(source);
        if (previous && previous[1] !== target) {
          throw new Error(
            `"${source}" is "${previous[1]}" in ${previous[0]} but "${target}" in ${area}`,
          );
        }
        seen.set(source, [area, target]);
      }
    }
  });

  it("never maps a source to itself or to an empty string", () => {
    for (const [source, target] of Object.entries(en)) {
      expect(target, source).not.toBe("");
      expect(target, source).not.toBe(source);
    }
  });

  it("keeps every placeholder of the source in the translation", () => {
    for (const [source, target] of Object.entries(en)) {
      const placeholders = source.match(/\{\w+\}/g) ?? [];
      for (const placeholder of placeholders) {
        const name = placeholder.slice(1, -1);
        expect(target, source).toMatch(new RegExp(`\\{${name}[}|]`));
      }
    }
  });
});
