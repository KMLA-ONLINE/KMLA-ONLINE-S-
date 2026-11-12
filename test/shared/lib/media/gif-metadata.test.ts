import { describe, expect, it } from "vitest";

import { stripGifMetadata } from "~/shared/lib/media/gif-metadata";

const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));

// GIF89a 명세의 블록을 손으로 조립한다. 2×1 화면, 전역 색상표 2색, 프레임 하나.
const header = [...ascii("GIF89a"), 2, 0, 1, 0, 0x80, 0, 0];
const globalColors = [0, 0, 0, 255, 255, 255];
const loop = [0x21, 0xff, 11, ...ascii("NETSCAPE2.0"), 3, 1, 0, 0, 0];
const comment = [0x21, 0xfe, 5, ...ascii("Seoul"), 0];
const xmp = [0x21, 0xff, 11, ...ascii("XMP DataXMP"), 4, ...ascii("<x/>"), 0];
const plainText = [0x21, 0x01, 12, ...Array<number>(12).fill(0), 2, 1, 2, 0];
const graphicControl = [0x21, 0xf9, 4, 0, 10, 0, 0, 0];
const frame = [0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0, 2, 2, 0x44, 0x01, 0];
const trailer = [0x3b];

/** 결과는 원본 조각을 이은 Blob이라 바이트로 읽어 비교한다. */
async function strip(bytes: number[]): Promise<number[]> {
  const source = new Uint8Array(bytes);
  const result = stripGifMetadata(new Blob([source]), source);
  return [...new Uint8Array(await result.arrayBuffer())];
}

describe("stripGifMetadata", () => {
  it("drops comments, plain text and other application data but keeps the animation", async () => {
    expect(
      await strip([
        ...header,
        ...globalColors,
        ...loop,
        ...comment,
        ...xmp,
        ...graphicControl,
        ...frame,
        ...plainText,
        ...trailer,
      ]),
    ).toEqual([
      ...header,
      ...globalColors,
      ...loop,
      ...graphicControl,
      ...frame,
      ...trailer,
    ]);
  });

  it("drops a plain text block's graphic control so it does not move to the next frame", async () => {
    const delayed = [0x21, 0xf9, 4, 0, 200, 0, 0, 0];
    expect(
      await strip([
        ...header,
        ...globalColors,
        ...delayed,
        ...plainText,
        ...frame,
        ...trailer,
      ]),
    ).toEqual([...header, ...globalColors, ...frame, ...trailer]);
  });

  it("keeps a frame's local color table", async () => {
    const local = [0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0x80, 1, 2, 3, 4, 5, 6];
    expect(
      await strip([
        ...header,
        ...globalColors,
        ...local,
        2,
        2,
        0x44,
        0x01,
        0,
        ...comment,
        ...trailer,
      ]),
    ).toEqual([
      ...header,
      ...globalColors,
      ...local,
      2,
      2,
      0x44,
      0x01,
      0,
      ...trailer,
    ]);
  });

  it("rejects bytes that are not a GIF", () => {
    const source = new Uint8Array(ascii("PNG not a gif"));
    expect(() => stripGifMetadata(new Blob([source]), source)).toThrow();
  });

  it("ends a GIF cut off mid-frame after its last whole frame", async () => {
    expect(
      await strip([
        ...header,
        ...globalColors,
        ...graphicControl,
        ...frame,
        ...graphicControl,
        ...frame.slice(0, 12),
      ]),
    ).toEqual([
      ...header,
      ...globalColors,
      ...graphicControl,
      ...frame,
      ...trailer,
    ]);
  });

  it("ends a GIF at bytes that are not a GIF block", async () => {
    expect(
      await strip([...header, ...globalColors, ...frame, 0x00, 0x00]),
    ).toEqual([...header, ...globalColors, ...frame, ...trailer]);
  });

  it("rejects a GIF with no whole frame", () => {
    const source = new Uint8Array([
      ...header,
      ...globalColors,
      ...frame.slice(0, 12),
    ]);
    expect(() => stripGifMetadata(new Blob([source]), source)).toThrow();
  });
});
