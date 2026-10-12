import { describe, expect, it, vi } from "vitest";

const loadPlayableAttachment = vi.hoisted(() =>
  vi.fn<() => Promise<string | null>>(() => Promise.resolve(null)),
);

import { MessageAttachments } from "~/features/messaging/components/message-attachments";
import type { MessageAttachment } from "~/features/messaging/model/types";
import { renderRoute, screen, waitFor } from "../../../router";

vi.mock("~/features/messaging/data/files", () => ({
  createAttachmentUrls: (paths: string[]) =>
    Promise.resolve(
      new Map(paths.map((path) => [path, `https://signed/${path}`])),
    ),
  toDownloadUrl: (url: string, name: string) => `${url}?download=${name}`,
  loadPlayableAttachment,
}));

const photo = (index: number): MessageAttachment => ({
  id: `a${index}`,
  kind: "image",
  mimeType: "image/webp",
  sizeBytes: 100,
  width: 10,
  height: 10,
  fileName: `p${index}.webp`,
  objectPath: `c/p${index}`,
  thumbnailPath: `c/p${index}/thumb`,
});

describe("MessageAttachments", () => {
  it("사진은 여섯 칸까지만 깔고 나머지 수를 마지막 칸에 보인다", () => {
    renderRoute(
      () => (
        <MessageAttachments
          attachments={Array.from({ length: 8 }, (_, index) => photo(index))}
          isOwn
        />
      ),
      { path: "/messenger/room" },
    );

    expect(
      screen.getAllByRole("button", { name: /^사진 크게 보기/ }),
    ).toHaveLength(5);
    expect(
      screen.getByRole("button", { name: "사진 2장 더 보기" }),
    ).toHaveTextContent("+2");
  });

  it("오디오를 불러오지 못하면 재생을 다시 눌러 새로 시도한다", async () => {
    loadPlayableAttachment.mockRejectedValueOnce(new Error("offline"));
    const { user } = renderRoute(
      () => (
        <MessageAttachments
          attachments={[
            {
              id: "s1",
              kind: "audio",
              mimeType: "audio/mpeg",
              sizeBytes: 100,
              width: null,
              height: null,
              fileName: "녹음.mp3",
              objectPath: "c/s1",
              thumbnailPath: null,
            },
          ]}
          isOwn
        />
      ),
      { path: "/messenger/room" },
    );

    await user.click(screen.getByRole("button", { name: "재생: 녹음.mp3" }));
    expect(await screen.findByText("불러오지 못했습니다")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "재생: 녹음.mp3" }));
    await waitFor(() =>
      expect(loadPlayableAttachment).toHaveBeenCalledTimes(2),
    );
    expect(
      await screen.findByText("재생할 수 없는 형식입니다"),
    ).toBeInTheDocument();
  });
});
