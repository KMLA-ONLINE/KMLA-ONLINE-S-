import { screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useNavigate } from "react-router";

import {
  PostFileList,
  PostImageGrid,
} from "~/features/posts/components/post-attachments";
import type { PostAttachment } from "~/features/posts/model/types";
import { renderRoute } from "../../../router";

function attachment(overrides: Partial<PostAttachment>): PostAttachment {
  return {
    attachment_id: "attachment-id",
    created_at: "2026-08-13T00:00:00Z",
    height: null,
    mime_type: "application/pdf",
    object_path: "post-id/attachment-id",
    original_filename: "document.pdf",
    position: 0,
    post_id: "post-id",
    ready_at: "2026-08-13T00:00:00Z",
    size_bytes: 10,
    status: "ready",
    storage_bucket: "post-attachments",
    thumbnail_path: null,
    thumbnailUrl: null,
    width: null,
    signedUrl: "https://example.com/file",
    ...overrides,
  };
}

const image = (id: string) =>
  attachment({
    attachment_id: id,
    mime_type: "image/webp",
    original_filename: `${id}.webp`,
  });

const gridRatio = () =>
  Number.parseFloat(screen.getByTestId("post-image-grid").style.aspectRatio);

function DuplicateImageGrids() {
  const navigate = useNavigate();
  const images = [image("shared")];

  return (
    <>
      <p>현재 화면</p>
      <button type="button" onClick={() => void navigate(-1)}>
        이전 화면으로
      </button>
      <PostImageGrid images={images} />
      <PostImageGrid images={images} />
    </>
  );
}

function ImageGridLeavingToStaleLink() {
  const navigate = useNavigate();

  return (
    <>
      <PostImageGrid images={[image("shared")]} />
      <button
        type="button"
        onClick={() => void navigate("/previous?image=shared")}
      >
        다른 화면으로
      </button>
    </>
  );
}

describe("PostImageGrid", () => {
  it("shows a single image at its own aspect ratio", () => {
    renderRoute(() => (
      <PostImageGrid
        images={[{ ...image("portrait"), width: 900, height: 1200 }]}
      />
    ));

    // 3:4 세로 사진. 16:9로 못 박으면 세로의 절반 넘게 잘린다.
    // 값을 숫자로 읽는 이유: jsdom이 `aspect-ratio`를 `"0.75 / 1"`로 정규화해 돌려준다.
    expect(gridRatio()).toBeCloseTo(0.75);
  });

  it("clamps a single image so one photo cannot swallow the feed", () => {
    const { unmount } = renderRoute(() => (
      <PostImageGrid
        images={[{ ...image("screenshot"), width: 1080, height: 1920 }]}
      />
    ));

    // 9:16 캡처를 그대로 두면 카드 폭의 1.78배 높이가 된다. 3:4에서 끊는다.
    expect(gridRatio()).toBeCloseTo(0.75);

    unmount();
    renderRoute(() => (
      <PostImageGrid
        images={[{ ...image("panorama"), width: 2100, height: 900 }]}
      />
    ));

    expect(gridRatio()).toBeCloseTo(16 / 9);
  });

  it("falls back to 16:9 when the attachment was never measured", () => {
    renderRoute(() => <PostImageGrid images={[image("unmeasured")]} />);

    const grid = screen.getByTestId("post-image-grid");
    expect(grid).toHaveClass("aspect-video");
    expect(grid).toHaveStyle({ aspectRatio: "" });
  });

  it("renders every image up to the tile limit", () => {
    renderRoute(() => (
      <PostImageGrid images={[image("a"), image("b"), image("c")]} />
    ));

    expect(screen.getAllByRole("img")).toHaveLength(3);
    expect(screen.queryByText(/^\+/)).not.toBeInTheDocument();
  });

  it("uses thumbnails for tiles and the original only for a full-width single tile", () => {
    const thumbnailed = (id: string) => ({
      ...image(id),
      thumbnailUrl: `https://example.com/thumbnail-${id}`,
    });
    const first = thumbnailed("a");
    const { unmount } = renderRoute(() => <PostImageGrid images={[first]} />);

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://example.com/thumbnail-a",
    );

    unmount();
    const { unmount: unmountSingle } = renderRoute(() => (
      <PostImageGrid images={[first]} allowOriginalTile />
    ));

    expect(screen.getByRole("img")).toHaveAttribute(
      "src",
      "https://example.com/file",
    );

    // 상세라도 두 장부터는 타일이 절반 이하로 줄어 축소본으로 충분하다.
    unmountSingle();
    renderRoute(() => (
      <PostImageGrid images={[first, thumbnailed("b")]} allowOriginalTile />
    ));

    expect(
      screen.getAllByRole("img").map((node) => node.getAttribute("src")),
    ).toEqual([
      "https://example.com/thumbnail-a",
      "https://example.com/thumbnail-b",
    ]);
  });

  it("caps visible tiles at five and marks the rest as overflow", () => {
    renderRoute(() => (
      <PostImageGrid images={["a", "b", "c", "d", "e", "f", "g"].map(image)} />
    ));

    expect(screen.getAllByRole("img")).toHaveLength(5);
    expect(screen.getByText("+2")).toBeInTheDocument();
  });

  it("disables the tile when the attachment could not be signed", () => {
    renderRoute(() => (
      <PostImageGrid
        images={[
          {
            ...image("broken"),
            signedUrl: null,
          },
        ]}
      />
    ));

    expect(screen.getByRole("button", { name: /broken.webp/ })).toBeDisabled();
    expect(
      screen.getByText("이미지를 불러오지 못했습니다"),
    ).toBeInTheDocument();
  });

  it("downloads an image under its attachment UUID", async () => {
    const { user } = renderRoute(() => (
      <PostImageGrid
        images={[image("image-uuid")].map((item) => ({
          ...item,
          original_filename: "원본 사진.webp",
        }))}
      />
    ));

    await user.click(screen.getByRole("button", { name: /원본 사진.webp/ }));

    const download = screen.getByRole("link", { name: "다운로드" });
    expect(download).toHaveAttribute(
      "href",
      "https://example.com/file?download=image-uuid.webp",
    );
    expect(download).toHaveAttribute("download", "image-uuid.webp");
  });

  it("closes one history entry when the same image is registered twice", async () => {
    const { user } = renderRoute(DuplicateImageGrids, {
      initialEntries: ["/previous", "/"],
      initialIndex: 1,
      routes: [{ path: "/previous", Component: () => <p>이전 화면</p> }],
    });

    await user.click(
      screen.getAllByRole("button", { name: "shared.webp 크게 보기" })[0],
    );
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);

    await user.keyboard("{Escape}");
    expect(await screen.findByText("현재 화면")).toBeVisible();
    expect(screen.queryByText("이전 화면")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "이전 화면으로" }));
    expect(await screen.findByText("이전 화면")).toBeVisible();
  });

  // provider는 화면보다 오래 산다. 화면을 떠난 그리드가 등록을 거두지 않으면, 그 사진을
  // 가리키는 `?image=`가 아무 화면에서나 뷰어를 연다.
  it("stops answering an image link once the grid leaves the screen", async () => {
    const { user } = renderRoute(ImageGridLeavingToStaleLink, {
      routes: [{ path: "/previous", Component: () => <p>이전 화면</p> }],
    });

    await user.click(screen.getByRole("button", { name: "다른 화면으로" }));

    expect(await screen.findByText("이전 화면")).toBeVisible();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens a direct image link in one global viewer", async () => {
    renderRoute(DuplicateImageGrids, { initialEntries: ["/?image=shared"] });

    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("opens a legacy image entry after a remount", async () => {
    renderRoute(DuplicateImageGrids, {
      initialEntries: [
        {
          pathname: "/",
          search: "?image=shared",
          state: { imageViewerOwner: ":legacy:" },
        },
      ],
    });

    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });
});

describe("PostFileList", () => {
  it("offers a download link for signed files", () => {
    renderRoute(() => <PostFileList files={[attachment({})]} />);

    expect(screen.getByRole("link", { name: /document.pdf/ })).toHaveAttribute(
      "download",
      "document.pdf",
    );
  });

  it("fails gracefully when signing fails", () => {
    renderRoute(() => (
      <PostFileList files={[attachment({ signedUrl: null })]} />
    ));

    expect(screen.getByText("다운로드할 수 없음")).toBeInTheDocument();
  });

  it("shows three files before expanding the complete list", async () => {
    const files = Array.from({ length: 5 }, (_, index) =>
      attachment({
        attachment_id: `file-${index}`,
        original_filename: `document-${index}.pdf`,
      }),
    );
    const { user } = renderRoute(() => <PostFileList files={files} />);

    expect(screen.getAllByRole("link")).toHaveLength(3);
    const expand = screen.getByRole("button", { name: "파일 5개 모두 보기" });
    await user.click(expand);
    expect(screen.getAllByRole("link")).toHaveLength(5);
    expect(
      within(screen.getByRole("region", { name: "첨부 파일" })).getByRole(
        "button",
        { name: "파일 목록 접기" },
      ),
    ).toHaveAttribute("aria-expanded", "true");
  });
});
