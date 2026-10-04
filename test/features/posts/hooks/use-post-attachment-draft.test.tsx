import { act, renderHook } from "@testing-library/react";
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
});
