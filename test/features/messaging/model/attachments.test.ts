import { describe, expect, it } from "vitest";

import {
  attachmentKindLabel,
  classifyAttachment,
  groupAttachmentsIntoMessages,
  limitAttachments,
  screenAttachments,
  sniffAudioFormat,
} from "~/features/messaging/model/attachments";
import { formatLastMessagePreview } from "~/features/messaging/model/conversation-preview";

const file = (name: string, type: string) => new File(["x"], name, { type });

function sized(name: string, type: string, size: number) {
  const made = file(name, type);
  Object.defineProperty(made, "size", { value: size });
  return made;
}

describe("message attachments", () => {
  it("사진은 모두 한 묶음, 파일과 오디오는 파일마다 메시지 하나로 나눈다", () => {
    const photos = Array.from({ length: 11 }, (_, index) =>
      file(`p${index}.jpg`, "image/jpeg"),
    );
    const groups = groupAttachmentsIntoMessages([
      file("a.pdf", "application/pdf"),
      ...photos,
      file("s.mp3", "audio/mpeg"),
    ]);

    expect(groups.map((group) => group.map(({ name }) => name))).toEqual([
      photos.map(({ name }) => name),
      ["a.pdf"],
      ["s.mp3"],
    ]);
    expect(classifyAttachment(file("x.heic", ""))).toBe("image");
  });

  it("이미 고른 것까지 합쳐 사진은 30장, 파일은 10개까지만 받는다", () => {
    const photos = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        file(`p${index}.jpg`, "image/jpeg"),
      );
    const files = (count: number) =>
      Array.from({ length: count }, (_, index) =>
        file(`f${index}.pdf`, "application/pdf"),
      );

    expect(limitAttachments([...photos(30), ...files(10)])).toMatchObject({
      overflow: false,
    });
    const limited = limitAttachments(
      [...photos(3), ...files(3)],
      [...photos(28), ...files(8)],
    );
    expect(limited.files.map(({ name }) => name)).toEqual([
      "p0.jpg",
      "p1.jpg",
      "f0.pdf",
      "f1.pdf",
    ]);
    expect(limited.overflow).toBe(true);
  });

  it("보내기 전에 30MB를 넘거나 빈 파일을 빼고 이유를 모은다", () => {
    const big = 30 * 1024 * 1024 + 1;

    const screened = screenAttachments([
      sized("ok.pdf", "application/pdf", 10),
      sized("big.pdf", "application/pdf", big),
      sized("big.jpg", "image/jpeg", big),
      sized("empty.txt", "text/plain", 0),
    ]);

    expect(screened.files.map(({ name }) => name)).toEqual(["ok.pdf"]);
    expect(screened.notices).toEqual([
      "30MB를 넘는 파일은 보낼 수 없습니다 (2개).",
      "빈 파일은 보낼 수 없습니다: empty.txt",
    ]);
    // 뺀 파일은 개수 상한에 들지 않는다.
    expect(
      screenAttachments([sized("big.pdf", "application/pdf", big)], []).notices,
    ).toEqual(["30MB를 넘는 파일은 보낼 수 없습니다: big.pdf"]);
  });

  it("동영상과 GIF를 MIME type이나 확장자로 알아본다", () => {
    expect(classifyAttachment(file("v.mp4", "video/mp4"))).toBe("video");
    expect(classifyAttachment(file("x.gif", "image/gif"))).toBe("gif");
    expect(classifyAttachment(file("clip.MOV", ""))).toBe("video");
    expect(classifyAttachment(file("p.jpg", "image/jpeg"))).toBe("image");
    expect(classifyAttachment(file("a.pdf", "application/pdf"))).toBe("file");
    expect(classifyAttachment(file("s.mp3", "audio/mpeg"))).toBe("audio");
    expect(classifyAttachment(file("voice.webm", "audio/webm"))).toBe("audio");
  });

  it("동영상은 입력 크기로 거르지 않고, GIF는 30MB까지 받는다", () => {
    const big = 200 * 1024 * 1024;
    const { files, notices } = screenAttachments([
      sized("long.mp4", "video/mp4", big),
      sized("big.gif", "image/gif", big),
    ]);
    expect(files.map(({ name }) => name)).toEqual(["long.mp4"]);
    expect(notices).toEqual(["GIF는 30MB 이하여야 합니다: big.gif"]);
  });

  it("동영상과 GIF는 메시지 하나에 하나씩 보낸다", () => {
    const groups = groupAttachmentsIntoMessages([
      file("a.mp4", "video/mp4"),
      file("b.gif", "image/gif"),
    ]);
    expect(groups.map((group) => group.length)).toEqual([1, 1]);
  });

  it("내려받은 앞부분으로 재생할 수 있는 오디오 형식만 알아본다", () => {
    const bytes = (...values: (number | string)[]) =>
      new Uint8Array(
        values.flatMap((value) =>
          typeof value === "string"
            ? [...value].map((char) => char.charCodeAt(0))
            : [value],
        ),
      );

    expect(sniffAudioFormat(bytes("ID3", 4, 0))).toBe("audio/mpeg");
    expect(sniffAudioFormat(bytes("OggS", 0))).toBe("audio/ogg");
    // 확장자가 mp3여도 내용이 다르면 재생하지 않는다.
    expect(sniffAudioFormat(bytes("%PDF-1.7"))).toBeNull();
  });

  it("첨부만 있는 메시지는 목록에서 첨부 종류로 부른다", () => {
    expect(attachmentKindLabel("audio")).toBe("파일");
    expect(
      formatLastMessagePreview(
        {
          type: "direct",
          viewerId: "me",
          participants: [],
          lastMessage: {
            senderId: "other",
            body: "",
            sentAt: "2026-08-28T06:00:00Z",
            attachmentKind: "image",
          },
        },
        "https://kmla.online",
      ),
    ).toBe("사진");
  });
});
