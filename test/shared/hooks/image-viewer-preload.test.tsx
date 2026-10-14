import { screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

const { downloaded } = vi.hoisted(() => ({ downloaded: vi.fn() }));
// 동적 import 경계를 관측한다. 뷰어 동작은 기존 첨부 테스트가 검증한다.
vi.mock("~/shared/components/image-viewer", () => {
  downloaded();
  return { ImageViewer: () => null };
});

import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import { renderRoute } from "../../router";

function Harness() {
  const [ready, setReady] = useState(false);
  useImageViewerParam(
    ready
      ? [
          {
            id: "photo",
            src: "https://example.com/photo.webp",
            name: "photo.webp",
            downloadSrc: "https://example.com/photo.webp",
          },
        ]
      : [],
  );
  return (
    <button type="button" onClick={() => setReady(true)}>
      이미지 준비
    </button>
  );
}

describe("image viewer preload", () => {
  it("downloads the viewer only after a non-empty image list is registered", async () => {
    const { user } = renderRoute(Harness);
    await screen.findByRole("button", { name: "이미지 준비" });
    expect(downloaded).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "이미지 준비" }));
    await vi.waitFor(() => expect(downloaded).toHaveBeenCalledOnce());
  });
});
