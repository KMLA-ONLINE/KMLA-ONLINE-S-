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

describe("stripGifMetadata", () => {
  it("drops comments, plain text and other application data but keeps the animation", () => {
    const source = new Uint8Array([
      ...header,
      ...globalColors,
      ...loop,
      ...comment,
      ...xmp,
      ...graphicControl,
      ...plainText,
      ...frame,
      ...trailer,
    ]);

    expect(stripGifMetadata(source)).toEqual(
      new Uint8Array([
        ...header,
        ...globalColors,
        ...loop,
        ...graphicControl,
        ...frame,
        ...trailer,
      ]),
    );
  });

  it("keeps a frame's local color table", () => {
    const local = [0x2c, 0, 0, 0, 0, 2, 0, 1, 0, 0x80, 1, 2, 3, 4, 5, 6];
    const source = new Uint8Array([
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
    ]);

    expect(stripGifMetadata(source)).toEqual(
      new Uint8Array([
        ...header,
        ...globalColors,
        ...local,
        2,
        2,
        0x44,
        0x01,
        0,
        ...trailer,
      ]),
    );
  });

  it("rejects bytes that are not a GIF", () => {
    expect(() =>
      stripGifMetadata(new Uint8Array(ascii("PNG not a gif"))),
    ).toThrow();
  });

  it("rejects a GIF cut off before its trailer", () => {
    const source = new Uint8Array([
      ...header,
      ...globalColors,
      ...frame.slice(0, 12),
    ]);
    expect(() => stripGifMetadata(source)).toThrow();
  });
});
