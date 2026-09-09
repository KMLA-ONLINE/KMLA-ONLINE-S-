import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { PostAttachmentEditor } from "~/features/posts/components/editor/post-attachment-editor";
import type { PreparedPostFile } from "~/features/posts/model/types";
import { renderRoute } from "../../../../router";

const file: PreparedPostFile = {
  key: "file-key",
  file: new File(["document"], "document.pdf", { type: "application/pdf" }),
  kind: "file",
  width: null,
  height: null,
  previewUrl: null,
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
    expect(onRetry).toHaveBeenCalledWith("file-key");
  });
});
