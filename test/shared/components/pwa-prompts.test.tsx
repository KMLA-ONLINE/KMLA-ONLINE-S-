import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PwaPrompts } from "~/shared/components/pwa-prompts";

const offline = vi.hoisted(() => ({ value: false }));
const serviceWorker = vi.hoisted(() => ({
  updateReady: false,
  applyingUpdate: false,
  updateAppliedElsewhere: false,
  applyUpdate: vi.fn(),
}));

vi.mock("~/shared/hooks/use-offline", () => ({
  useOffline: () => offline.value,
}));
vi.mock("~/shared/hooks/use-service-worker", () => ({
  useServiceWorker: () => serviceWorker,
}));
vi.mock("~/shared/hooks/use-stale-chunk-recovery", () => ({
  useStaleChunkRecovery: () => undefined,
}));
vi.mock("~/shared/hooks/use-in-app-escape", () => ({
  useInAppEscape: () => undefined,
}));
vi.mock("~/shared/components/install-prompt", () => ({
  InstallPrompt: () => null,
}));

describe("PwaPrompts", () => {
  afterEach(() => {
    window.localStorage.clear();
    offline.value = false;
    serviceWorker.updateReady = false;
  });

  it("shows the offline notice in Korean by default", () => {
    offline.value = true;
    render(<PwaPrompts />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "인터넷에 연결되어 있지 않아요.",
    );
  });

  it("shows the offline notice and the update banner in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    offline.value = true;
    const { rerender } = render(<PwaPrompts />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "You're not connected to the internet.",
    );

    offline.value = false;
    serviceWorker.updateReady = true;
    rerender(<PwaPrompts />);

    expect(screen.getByRole("status")).toHaveTextContent(
      "A new version is ready.",
    );
    expect(screen.getByRole("button", { name: "Refresh" })).toBeVisible();
  });
});
