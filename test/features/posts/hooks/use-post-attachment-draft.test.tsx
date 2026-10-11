import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { preparePostFiles } from "~/features/posts/model/attachments";
import type * as PostAttachmentModule from "~/features/posts/model/attachments";
import type { PreparedPostFile } from "~/features/posts/model/types";
import { usePostAttachmentDraft } from "~/features/posts/hooks/use-post-attachment-draft";

vi.mock("~/features/posts/data/mutations", () => ({
  createPostUploadSession: () => ({
    files: new Map(),
    listeners: new Set(),
    queue: [],
    activeUploads: 0,
    cancelled: false,
    controllers: new Map(),
  }),
  discardPostFileUpload: vi.fn(),
  subscribePostUploadSession: vi.fn(() => () => undefined),
}));

vi.mock("~/features/posts/model/attachments", async (importOriginal) => {
  const actual = await importOriginal<typeof PostAttachmentModule>();
  return { ...actual, preparePostFiles: vi.fn() };
});

const prepare = vi.mocked(preparePostFiles);

function asFileList(files: File[]): FileList {
  return files as unknown as FileList;
}

beforeEach(() => {
  prepare.mockReset();
  prepare.mockImplementation((files, _currentCount, _selection, options) => {
    const prepared = files.map<PreparedPostFile>((file) => ({
      key: file.name,
      file,
      thumbnail: null,
      kind: "file",
      width: null,
      height: null,
      previewUrl: null,
    }));
    prepared.forEach((item) => options?.onPrepared?.(item));
    return Promise.resolve(prepared);
  });
});

describe("usePostAttachmentDraft", () => {
  it("excludes videos before preparation while keeping supported files", async () => {
    const preupload = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      usePostAttachmentDraft({
        initialAttachments: [],
        disabled: false,
        preupload,
      }),
    );
    const video = new File(["video"], "clip.mp4", { type: "video/mp4" });
    const document = new File(["document"], "notice.pdf", {
      type: "application/pdf",
    });

    await act(() =>
      result.current.addFiles(asFileList([video, document]), "mixed"),
    );

    expect(prepare).toHaveBeenCalledWith(
      [document],
      0,
      "mixed",
      expect.any(Object),
    );
    expect(result.current.additions.map((item) => item.file)).toEqual([
      document,
    ]);
    expect(preupload).toHaveBeenCalledOnce();
    expect(result.current.preparationError).toBe(
      "동영상은 첨부할 수 없어 제외했습니다: clip.mp4",
    );
    expect(result.current.preparingCount).toBe(0);
  });

  it("does not enter the preparation state when only a video is selected", async () => {
    const { result } = renderHook(() =>
      usePostAttachmentDraft({
        initialAttachments: [],
        disabled: false,
        preupload: vi.fn(),
      }),
    );
    const video = new File(["video"], "clip.mov", {
      type: "application/octet-stream",
    });

    await act(() => result.current.addFiles(asFileList([video]), "file"));

    expect(prepare).not.toHaveBeenCalled();
    expect(result.current.preparingCount).toBe(0);
    expect(result.current.preparationError).toContain("clip.mov");
  });

  describe("paste", () => {
    const innerPaste = vi.fn();
    function Screen({ disabled = false }: { disabled?: boolean }) {
      const { pasteHandlers } = usePostAttachmentDraft({
        initialAttachments: [],
        disabled,
        preupload: vi.fn().mockResolvedValue(undefined),
      });
      return (
        <div {...pasteHandlers}>
          <input aria-label="제목" onPaste={innerPaste} />
        </div>
      );
    }
    const png = new File(["x"], "shot.png", { type: "image/png" });
    const jpeg = new File(["x"], "photo.jpg", { type: "image/jpeg" });
    const gif = new File(["x"], "anim.gif", { type: "image/gif" });
    const clipboardData = (
      files: File[],
      text: Record<string, string> = {},
    ) => ({
      getData: (type: string) => text[type] ?? "",
      items: files.map((file) => ({
        kind: "file",
        type: file.type,
        getAsFile: () => file,
      })),
    });

    beforeEach(() => innerPaste.mockClear());

    it("adds every pasted image before the focused field sees the paste", async () => {
      render(<Screen />);

      fireEvent.paste(screen.getByLabelText("제목"), {
        clipboardData: clipboardData([png, jpeg]),
      });

      await waitFor(() =>
        expect(prepare).toHaveBeenCalledWith(
          [png, jpeg],
          0,
          "image",
          expect.any(Object),
        ),
      );
      expect(innerPaste).not.toHaveBeenCalled();
    });

    it("takes a paste when nothing is focused, but not one in a field outside the form", async () => {
      render(<Screen />);
      const outside = document.createElement("input");
      document.body.append(outside);

      fireEvent.paste(outside, { clipboardData: clipboardData([png]) });
      expect(prepare).not.toHaveBeenCalled();

      fireEvent.paste(document.body, { clipboardData: clipboardData([png]) });
      await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
      outside.remove();
    });

    it("leaves the paste alone when it cannot attach anything", () => {
      const { rerender } = render(<Screen />);
      const title = screen.getByLabelText("제목");

      // 스프레드시트 셀 복사: 표 HTML과 함께 PNG가 실린다.
      fireEvent.paste(title, {
        clipboardData: clipboardData([png], {
          "text/plain": "a	b",
          "text/html": "<table><tr><td>a</td><td>b</td></tr></table>",
        }),
      });
      fireEvent.paste(title, { clipboardData: clipboardData([gif]) });
      rerender(<Screen disabled />);
      fireEvent.paste(title, { clipboardData: clipboardData([png]) });

      expect(innerPaste).toHaveBeenCalledTimes(3);
      expect(prepare).not.toHaveBeenCalled();
    });
  });
});
