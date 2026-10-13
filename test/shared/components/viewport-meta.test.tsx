/* eslint-disable testing-library/no-node-access -- Viewport metadata and parser-time
   scripts have no accessible role; the public document head is the boundary under test. */
import { runInNewContext } from "node:vm";
import { act } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ViewportMeta } from "~/shared/components/viewport-meta";

function initialDocument(userAgent: string, maxTouchPoints = 0) {
  const page = document.implementation.createHTMLDocument();
  page.head.innerHTML = renderToStaticMarkup(<ViewportMeta />);
  const script = page.head.querySelector("script");
  if (!script?.textContent) throw new Error("Missing viewport bootstrap");
  // Run the parser-time script from the generated document, before hydration.
  runInNewContext(script.textContent, {
    document: page,
    navigator: { userAgent, maxTouchPoints },
  });
  return page;
}

describe("initial viewport metadata", () => {
  it("preserves a single iOS viewport through document hydration and rerender", async () => {
    const page = initialDocument("iPhone", 5);
    page.body.innerHTML = "<span>0</span>";
    const shell = (version: number) => (
      <html lang="ko">
        <head>
          <ViewportMeta />
        </head>
        <body>
          <span>{version}</span>
        </body>
      </html>
    );
    const errors: unknown[] = [];
    page.documentElement.lang = "ko";
    let root: Root | undefined;

    try {
      await act(async () => {
        root = hydrateRoot(page, shell(0), {
          onRecoverableError: (error) => errors.push(error),
        });
        await Promise.resolve();
      });
      // eslint-disable-next-line testing-library/no-unnecessary-act -- This is React's raw root.render, not Testing Library's act-wrapped render.
      await act(async () => {
        root?.render(shell(1));
        await Promise.resolve();
      });

      expect(errors).toEqual([]);
      expect(page.querySelectorAll('meta[name="viewport"]')).toHaveLength(1);
      expect(
        page.querySelector('meta[name="viewport"]')?.getAttribute("content"),
      ).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
    } finally {
      await act(async () => {
        root?.unmount();
        await Promise.resolve();
      });
    }
  });

  it.each(["iPad", "iPod"])("enables safe-area layout on %s", (device) => {
    const page = initialDocument(
      `Mozilla/5.0 (${device}; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148`,
      5,
    );

    expect(
      page.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    ).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
  });

  it.each([
    [
      "Android",
      "Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 Chrome/135.0.0.0 Mobile Safari/537.36",
      5,
    ],
    [
      "macOS",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      0,
    ],
    [
      "Windows touch device",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/135.0.0.0 Safari/537.36",
      10,
    ],
  ])("preserves the default viewport on %s", (_, userAgent, maxTouchPoints) => {
    const page = initialDocument(userAgent, maxTouchPoints);

    expect(
      page.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    ).toBe("width=device-width, initial-scale=1");
    expect(page.querySelectorAll('meta[name="viewport"]')).toHaveLength(1);
  });

  it("enables safe-area layout on iPadOS using a desktop user agent", () => {
    const page = initialDocument(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Safari/605.1.15",
      5,
    );

    expect(
      page.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    ).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
  });

  it("enables safe-area layout on iPhone before hydration", () => {
    const page = initialDocument(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      5,
    );

    expect(
      page.querySelector('meta[name="viewport"]')?.getAttribute("content"),
    ).toBe("width=device-width, initial-scale=1, viewport-fit=cover");
  });
});
