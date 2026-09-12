import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PostAttachmentEditor } from "~/features/posts/components/editor/post-attachment-editor";
import type { PreparedPostFile } from "~/features/posts/model/types";
import { renderRoute } from "../../../../router";

const file: PreparedPostFile = {
  key: "file-key",
  file: new File(["document"], "document.pdf", { type: "application/pdf" }),
  thumbnail: null,
  kind: "file",
  width: null,
  height: null,
  previewUrl: null,
};

const imageFile: PreparedPostFile = {
  key: "image-key",
  file: new File(["image"], "photo.webp", { type: "image/webp" }),
  thumbnail: null,
  kind: "image",
  width: 20,
  height: 10,
  previewUrl: "blob:photo",
};

function renderEditor(
  overrides: Partial<Parameters<typeof PostAttachmentEditor>[0]> = {},
) {
  const props: Parameters<typeof PostAttachmentEditor>[0] = {
    existing: [],
    additions: [file],
    order: [file.key],
    disabled: false,
    isDragging: false,
    preparingCount: 0,
    preparationError: undefined,
    uploadStates: {},
    onSelect: vi.fn(),
    onRemoveExisting: vi.fn(),
    onRemoveAddition: vi.fn(),
    onMove: vi.fn(),
    onRetry: vi.fn(),
    ...overrides,
  };
  return { ...renderRoute(() => <PostAttachmentEditor {...props} />), props };
}

describe("PostAttachmentEditor", () => {
  it("does not shrink and clip a long attachment list", () => {
    renderEditor();

    expect(screen.getByRole("region", { name: "첨부 파일" })).toHaveClass(
      "shrink-0",
    );
  });

  it("keeps the empty mobile state to compact icon actions", () => {
    renderEditor({ additions: [], order: [] });

    expect(screen.getByText("사진 추가")).toHaveClass("hidden", "sm:inline");
    expect(screen.getByText("파일 추가")).toHaveClass("hidden", "sm:inline");
    expect(
      screen.getByRole("button", {
        name: /사진이나 파일을 끌어 놓으세요/,
      }),
    ).toHaveClass("hidden", "sm:flex");
  });

  it("shows the 30-file limit and immediate upload state", () => {
    renderEditor({
      uploadStates: {
        "file-key": { status: "uploading", progress: 0.42 },
      },
    });

    expect(screen.getByText("1 / 30")).toBeVisible();
    expect(screen.getByText("업로드 중 42%")).toBeVisible();
    expect(screen.getByRole("progressbar")).toHaveValue(0.42);
  });

  it("offers retry for a failed upload", async () => {
    const onRetry = vi.fn();
    const { user } = renderEditor({
      onRetry,
      uploadStates: {
        "file-key": { status: "error", progress: 0, error: "offline" },
      },
    });

    await user.click(
      screen.getByRole("button", { name: "document.pdf 업로드 다시 시도" }),
    );
    expect(screen.getByText("offline")).toBeVisible();
    expect(onRetry).toHaveBeenCalledWith("file-key");
  });

  it("shows how many files are still being optimized", () => {
    renderEditor({ preparingCount: 2 });

    expect(screen.getByText("파일 최적화 중 2개")).toBeVisible();
  });

  it("explains the video policy before selection and shows rejection inline", () => {
    renderEditor({
      additions: [],
      order: [],
      preparationError: "동영상은 첨부할 수 없어 제외했습니다: clip.mp4",
    });

    expect(screen.getByText("동영상 미지원")).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "동영상은 첨부할 수 없어 제외했습니다: clip.mp4",
    );
  });

  it("hides image filenames while retaining an accessible image label", () => {
    renderEditor({ additions: [imageFile], order: [imageFile.key] });

    expect(screen.queryByText("photo.webp")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "사진 1 첨부 메뉴" }),
    ).toBeVisible();
  });
});
