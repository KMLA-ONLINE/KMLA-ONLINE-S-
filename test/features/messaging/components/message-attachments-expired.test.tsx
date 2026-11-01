import { describe, expect, it, vi } from "vitest";

const createAttachmentUrls = vi.hoisted(() =>
  vi.fn((paths: string[]) =>
    Promise.resolve(
      new Map(paths.map((path) => [path, `https://signed/${path}`])),
    ),
  ),
);

import { MessageAttachments } from "~/features/messaging/components/message-attachments";
import { toAttachments } from "~/features/messaging/data/queries";
import type { MessageAttachment } from "~/features/messaging/model/types";
import { renderRoute, screen, waitFor } from "../../../router";

vi.mock("~/features/messaging/data/files", () => ({
  createAttachmentUrls,
  toDownloadUrl: (url: string, name: string) => `${url}?download=${name}`,
  loadPlayableAttachment: () => Promise.resolve(null),
}));

const expired = (
  kind: MessageAttachment["kind"],
  thumbnailPath: string | null,
): MessageAttachment => ({
  id: "a1",
  kind,
  mimeType: "application/octet-stream",
  sizeBytes: 600_000,
  width: 10,
  height: 10,
  fileName: "report.zip",
  objectPath: "c/a1",
  thumbnailPath,
  expired: true,
});

function renderAttachment(attachment: MessageAttachment) {
  renderRoute(
    () => <MessageAttachments attachments={[attachment]} isOwn={false} />,
    { path: "/messenger/room" },
  );
}

describe("보존 기간이 지난 메시지 첨부", () => {
  it("파일은 이름만 남기고 내려받기 링크를 두지 않는다", () => {
    renderAttachment(expired("file", null));

    expect(screen.getByText("report.zip")).toBeInTheDocument();
    expect(screen.getByText("보관 기간 만료")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("오디오는 재생 버튼을 두지 않는다", () => {
    renderAttachment(expired("audio", null));

    expect(screen.getByText("보관 기간 만료")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("동영상은 첫 프레임만 받고 뷰어를 열지 않는다", async () => {
    createAttachmentUrls.mockClear();
    renderAttachment(expired("video", "c/a1/thumb"));

    expect(screen.getByText("보관 기간 만료")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(createAttachmentUrls).toHaveBeenCalledWith(["c/a1/thumb"]),
    );
  });

  it("서버의 만료 표시를 옮긴다", () => {
    const [row] = toAttachments([
      {
        id: "a1",
        kind: "file",
        mime_type: "application/zip",
        size_bytes: 600_000,
        width: null,
        height: null,
        object_path: "c/a1",
        thumbnail_path: null,
        expired: true,
        file_name: "report.zip",
      },
    ]);

    expect(row?.expired).toBe(true);
  });
});
