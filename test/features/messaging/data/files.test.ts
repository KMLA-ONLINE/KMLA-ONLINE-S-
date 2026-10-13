import { afterEach, describe, expect, it, vi } from "vitest";

import { uploadAttachments } from "~/features/messaging/data/files";
import { uploadStorageObject } from "~/shared/supabase/upload";

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({
    rpc: () =>
      Promise.resolve({
        data: [
          {
            attachment_id: "a0",
            object_path: "c/m/0",
            thumbnail_path: null,
          },
          {
            attachment_id: "a1",
            object_path: "c/m/1",
            thumbnail_path: null,
          },
        ],
        error: null,
      }),
  }),
}));
vi.mock("~/shared/supabase/upload", () => ({
  uploadStorageObject: vi.fn(() => Promise.resolve()),
}));

const prepared = (name: string) => ({
  kind: "image" as const,
  file: new File(["x"], name, { type: "image/webp" }),
  thumbnail: null,
  fileName: name,
  width: 10,
  height: 10,
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(uploadStorageObject).mockReset();
  vi.mocked(uploadStorageObject).mockResolvedValue(undefined);
});

describe("uploadAttachments", () => {
  it("한 장이 잠깐 실패하면 그 장만 다시 올린다", async () => {
    vi.useFakeTimers();
    vi.mocked(uploadStorageObject).mockImplementation((_bucket, path) =>
      path === "c/m/1" &&
      vi
        .mocked(uploadStorageObject)
        .mock.calls.filter(([, called]) => called === "c/m/1").length === 1
        ? Promise.reject(new Error("network"))
        : Promise.resolve(),
    );

    const upload = uploadAttachments("c", "m", [
      prepared("a.webp"),
      prepared("b.webp"),
    ]);
    await vi.runAllTimersAsync();

    await expect(upload).resolves.toHaveLength(2);
    const paths = vi
      .mocked(uploadStorageObject)
      .mock.calls.map(([, path]) => path);
    expect(paths.filter((path) => path === "c/m/0")).toHaveLength(1);
    expect(paths.filter((path) => path === "c/m/1")).toHaveLength(2);
  });

  it("다시 올렸을 때 이미 있다고 하면 앞선 시도가 올라간 것으로 본다", async () => {
    vi.useFakeTimers();
    vi.mocked(uploadStorageObject)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("network"))
      .mockRejectedValueOnce(
        Object.assign(new Error("The resource already exists"), {
          statusCode: "409",
        }),
      );

    const upload = uploadAttachments("c", "m", [
      prepared("a.webp"),
      prepared("b.webp"),
    ]);
    await vi.runAllTimersAsync();

    await expect(upload).resolves.toHaveLength(2);
  });

  it("끝내 올라가지 않으면 실패로 끝난다", async () => {
    vi.useFakeTimers();
    vi.mocked(uploadStorageObject).mockImplementation((_bucket, path) =>
      path === "c/m/1"
        ? Promise.reject(new Error("network"))
        : Promise.resolve(),
    );

    const upload = uploadAttachments("c", "m", [
      prepared("a.webp"),
      prepared("b.webp"),
    ]);
    const settled = expect(upload).rejects.toThrow("network");
    await vi.runAllTimersAsync();

    await settled;
    expect(
      vi
        .mocked(uploadStorageObject)
        .mock.calls.filter(([, path]) => path === "c/m/1"),
    ).toHaveLength(3);
  });
});
