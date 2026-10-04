import { screen } from "@testing-library/react";
import { useLocation } from "react-router";
import { describe, expect, it } from "vitest";

import { useImageViewerParam } from "~/shared/hooks/use-image-viewer-param";
import { renderRoute } from "../../router";

function ViewerStateProbe() {
  const viewer = useImageViewerParam([
    {
      id: "image-id",
      src: "https://example.com/image.webp",
      downloadSrc: "https://example.com/image.webp?download=image.webp",
      name: "image.webp",
    },
  ]);
  const location = useLocation();

  return (
    <>
      <button type="button" onClick={() => viewer.open("image-id")}>
        이미지 열기
      </button>
      <output>{JSON.stringify(location.state)}</output>
    </>
  );
}

describe("useImageViewerParam", () => {
  it("preserves route state while adding its history marker", async () => {
    const { user } = renderRoute(ViewerStateProbe, {
      initialEntries: [
        {
          pathname: "/",
          state: { fromGroup: true },
        },
      ],
    });

    await user.click(screen.getByRole("button", { name: "이미지 열기" }));

    expect(screen.getByText(/"fromGroup":true/)).toBeInTheDocument();
    expect(screen.getByText(/"imageViewerPushed":true/)).toBeInTheDocument();
  });
});
