import { describe, expect, it } from "vitest";

import {
  attachmentKindLabel,
  classifyAttachment,
  groupAttachmentsIntoMessages,
  isBlockedAttachment,
  sniffPlayableFormat,
} from "~/features/messaging/model/attachments";
import { formatLastMessagePreview } from "~/features/messaging/model/conversation-preview";

const file = (name: string, type: string) => new File(["x"], name, { type });

describe("message attachments", () => {
  it("사진은 열 개씩 한 묶음, 파일과 오디오는 파일마다 메시지 하나로 나눈다", () => {
    const photos = Array.from({ length: 11 }, (_, index) =>
      file(`p${index}.jpg`, "image/jpeg"),
    );
    const groups = groupAttachmentsIntoMessages([
      file("a.pdf", "application/pdf"),
      ...photos,
      file("s.mp3", "audio/mpeg"),
    ]);

    expect(groups.map((group) => group.map(({ name }) => name))).toEqual([
      photos.slice(0, 10).map(({ name }) => name),
      ["p10.jpg"],
      ["a.pdf"],
      ["s.mp3"],
    ]);
    expect(classifyAttachment(file("x.heic", ""))).toBe("image");
  });

  it("동영상과 GIF는 MIME type이나 확장자로 보내지 않는다", () => {
    expect(isBlockedAttachment(file("v.mp4", "video/mp4"))).toBe(true);
    expect(isBlockedAttachment(file("x.gif", "image/gif"))).toBe(true);
    expect(isBlockedAttachment(file("clip.MOV", ""))).toBe(true);
    expect(isBlockedAttachment(file("p.jpg", "image/jpeg"))).toBe(false);
    expect(isBlockedAttachment(file("a.pdf", "application/pdf"))).toBe(false);
    expect(isBlockedAttachment(file("s.mp3", "audio/mpeg"))).toBe(false);
    expect(isBlockedAttachment(file("voice.webm", "audio/webm"))).toBe(false);
  });

  it("내려받은 앞부분으로 재생할 수 있는 형식만 알아본다", () => {
    const bytes = (...values: (number | string)[]) =>
      new Uint8Array(
        values.flatMap((value) =>
          typeof value === "string"
            ? [...value].map((char) => char.charCodeAt(0))
            : [value],
        ),
      );

    expect(sniffPlayableFormat(bytes(0, 0, 0, 0x18, "ftypmp42"), "video")).toBe(
      "video/mp4",
    );
    expect(sniffPlayableFormat(bytes(0, 0, 0, 0x14, "ftypqt  "), "video")).toBe(
      "video/quicktime",
    );
    expect(sniffPlayableFormat(bytes("ID3", 4, 0), "audio")).toBe("audio/mpeg");
    expect(sniffPlayableFormat(bytes("OggS", 0), "audio")).toBe("audio/ogg");
    // 확장자가 mp4여도 내용이 다르면 재생하지 않는다.
    expect(sniffPlayableFormat(bytes("%PDF-1.7"), "video")).toBeNull();
  });

  it("첨부만 있는 메시지는 목록에서 첨부 종류로 부른다", () => {
    expect(attachmentKindLabel("audio")).toBe("파일");
    expect(
      formatLastMessagePreview({
        type: "direct",
        viewerId: "me",
        participants: [],
        lastMessage: {
          senderId: "other",
          body: "",
          sentAt: "2026-08-28T06:00:00Z",
          attachmentKind: "image",
        },
      }),
    ).toBe("사진");
  });
});
