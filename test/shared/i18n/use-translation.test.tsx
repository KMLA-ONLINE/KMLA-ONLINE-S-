import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  LANGUAGE_STORAGE_KEY,
  writeLanguagePreference,
} from "~/shared/i18n/language";
import {
  LanguageEffects,
  useLanguagePreference,
  useLocale,
  useT,
} from "~/shared/i18n/use-translation";

afterEach(() => {
  window.localStorage.clear();
  document.documentElement.lang = "ko";
});

function Probe() {
  const t = useT();
  const locale = useLocale();
  const [preference] = useLanguagePreference();
  return (
    <p>
      {t("실험실")} / {locale} / {preference}
    </p>
  );
}

describe("useT", () => {
  it("renders Korean by default and re-renders on change", () => {
    render(<Probe />);
    expect(screen.getByText("실험실 / ko / ko")).toBeInTheDocument();

    act(() => writeLanguagePreference("en"));
    expect(screen.getByText("Lab / en / en")).toBeInTheDocument();
  });

  it("reads a stored choice on mount", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    render(<Probe />);
    expect(screen.getByText("Lab / en / en")).toBeInTheDocument();
  });
});

describe("LanguageEffects", () => {
  it("keeps <html lang> in sync with the resolved locale", () => {
    render(<LanguageEffects />);
    expect(document.documentElement.lang).toBe("ko");

    act(() => writeLanguagePreference("en"));
    expect(document.documentElement.lang).toBe("en");
  });
});
