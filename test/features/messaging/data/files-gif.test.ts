import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  copyAttachments,
  uploadAttachments,
} from "~/features/messaging/data/files";
import { toAttachments } from "~/features/messaging/data/queries";
import { uploadStorageObject } from "~/shared/supabase/upload";

const { rpc, copy } = vi.hoisted(() => ({ rpc: vi.fn(), copy: vi.fn() }));

vi.mock("~/shared/supabase/client", () => ({
  getSupabase: () => ({ rpc, storage: { from: () => ({ copy }) } }),
}));
vi.mock("~/shared/supabase/upload", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  uploadStorageObject: vi.fn(() => Promise.resolve()),
}));

const target = {
  attachment_id: "a0",
  object_path: "c/a0",
  thumbnail_path: "c/a0/thumb",
  gif_path: "c/a0/gif",
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({ data: [target], error: null });
  copy.mockResolvedValue({ error: null });
});

describe("archived GIF", () => {
  it("reserves, uploads and returns a GIF's archived GIF", async () => {
    const gif = new File(["gif"], "gif.gif", { type: "image/gif" });
    const [sent] = await uploadAttachments("c", "m", [
      {
        kind: "gif",
        file: new File(["mp4"], "gif.mp4", { type: "video/mp4" }),
        thumbnail: null,
        gif,
        fileName: "gif.mp4",
        width: 10,
        height: 10,
      },
    ]);

    expect(rpc).toHaveBeenCalledWith(
      "prepare_message_attachments",
      expect.objectContaining({
        p_files: [expect.objectContaining({ kind: "gif", keep_gif: true })],
      }),
    );
    expect(uploadStorageObject).toHaveBeenCalledWith(
      "message-attachments",
      "c/a0/gif",
      gif,
      expect.any(Function),
    );
    expect(sent?.gifPath).toBe("c/a0/gif");
  });

  it("copies the archived GIF when forwarding", async () => {
    await copyAttachments("d", "m", [
      {
        id: "s0",
        kind: "gif",
        mimeType: "video/mp4",
        sizeBytes: 3,
        width: 10,
        height: 10,
        fileName: "gif.mp4",
        objectPath: "c/s0",
        thumbnailPath: null,
        gifPath: "c/s0/gif",
      },
    ]);

    expect(rpc).toHaveBeenCalledWith(
      "prepare_message_attachments",
      expect.objectContaining({
        p_files: [expect.objectContaining({ keep_gif: true })],
      }),
    );
    expect(copy).toHaveBeenCalledWith("c/s0/gif", "c/a0/gif");
  });

  it("reads the archived GIF path from message pages", () => {
    expect(
      toAttachments([
        {
          id: "s0",
          kind: "gif",
          mime_type: "video/mp4",
          size_bytes: 3,
          width: 10,
          height: 10,
          object_path: "c/s0",
          thumbnail_path: null,
          gif_path: "c/s0/gif",
          file_name: "gif.mp4",
        },
      ])[0]?.gifPath,
    ).toBe("c/s0/gif");
  });
});
