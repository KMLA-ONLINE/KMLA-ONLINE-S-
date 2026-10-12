import { describe, expect, it, vi } from "vitest";

import { MessageAttachments } from "~/features/messaging/components/message-attachments";
import type { MessageAttachment } from "~/features/messaging/model/types";
import { renderRoute, screen } from "../../../router";

vi.mock("~/features/messaging/data/files", () => ({
  createAttachmentUrls: (paths: string[]) =>
    Promise.resolve(
      new Map(paths.map((path) => [path, `https://signed/${path}`])),
    ),
  toDownloadUrl: (url: string, name: string) => `${url}?download=${name}`,
  loadPlayableAttachment: () => Promise.resolve(null),
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
});
