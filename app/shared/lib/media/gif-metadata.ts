/** 반복 재생 횟수를 담는 application extension. 이것만 남기고 나머지 application 데이터는 지운다. */
const LOOP_APPLICATIONS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

const EXTENSION = 0x21;
const IMAGE = 0x2c;
const TRAILER = 0x3b;
const GRAPHIC_CONTROL = 0xf9;
const PLAIN_TEXT = 0x01;
const APPLICATION = 0xff;

type Range = [start: number, end: number];

/**
 * GIF에서 그림에 쓰이지 않는 블록을 지운다. 주석, plain text, 반복 정보가 아닌 application 데이터(XMP,
 * ICC 등)가 대상이다. 프레임과 색상표, 프레임 지연은 바이트 그대로 둔다.
 *
 * 결과는 `file`의 조각을 이은 Blob이라 30MiB GIF도 메모리에 사본을 만들지 않는다. `bytes`는 같은 파일의
 * 내용이다. 끝 표시가 없거나 중간에 끊기거나 모르는 바이트가 나오면 브라우저처럼 마지막 온전한 블록까지
 * 쓰고 끝 표시를 붙인다. GIF가 아니거나 온전한 프레임이 하나도 없으면 던진다.
 */
export function stripGifMetadata(file: Blob, bytes: Uint8Array): Blob {
  const reader = new GifReader(bytes);
  const signature = reader.text(6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("Not a GIF");
  }
  reader.skip(4);
  const packed = reader.byte();
  reader.skip(2);
  if (packed & 0x80) reader.skip(colorTableBytes(packed));

  const kept: Range[] = [[0, reader.offset]];
  // Graphic control은 바로 다음 그림 블록에 붙는다. 그 블록이 지울 plain text면 함께 지워야
  // 다음 프레임의 지연·투명색이 바뀌지 않는다.
  let control: Range | null = null;
  let frames = 0;
  let ended = false;

  try {
    while (!ended) {
      const start = reader.offset;
      const introducer = reader.byte();
      if (introducer === TRAILER) {
        ended = true;
      } else if (introducer === IMAGE) {
        reader.skip(8);
        const local = reader.byte();
        if (local & 0x80) reader.skip(colorTableBytes(local));
        reader.skip(1);
        reader.subBlocks();
        if (control) kept.push(control);
        kept.push([start, reader.offset]);
        control = null;
        frames += 1;
      } else if (introducer === EXTENSION) {
        const label = reader.byte();
        let loop = false;
        if (label === APPLICATION) {
          const size = reader.byte();
          loop = size === 11 && LOOP_APPLICATIONS.has(reader.text(11));
          if (size !== 11) reader.skip(size);
        }
        reader.subBlocks();
        if (label === GRAPHIC_CONTROL) control = [start, reader.offset];
        else if (label === PLAIN_TEXT) control = null;
        else if (loop) kept.push([start, reader.offset]);
      } else {
        break;
      }
    }
  } catch (error) {
    if (!(error instanceof TruncatedGifError)) throw error;
  }
  if (frames === 0) throw new Error("GIF has no whole frame");

  return new Blob([
    ...merge(kept).map(([start, end]) => file.slice(start, end)),
    new Uint8Array([TRAILER]),
  ]);
}

function colorTableBytes(packed: number): number {
  return 3 * 2 ** ((packed & 0x07) + 1);
}

/** 이어진 조각을 하나로 합친다. */
function merge(ranges: Range[]): Range[] {
  const merged: Range[] = [];
  for (const [start, end] of ranges) {
    const last = merged.at(-1);
    if (last?.[1] === start) last[1] = end;
    else merged.push([start, end]);
  }
  return merged;
}

class TruncatedGifError extends Error {
  constructor() {
    super("Truncated GIF");
  }
}

class GifReader {
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.offset >= this.bytes.length) throw new TruncatedGifError();
    return this.bytes[this.offset++];
  }

  skip(count: number) {
    if (this.offset + count > this.bytes.length) {
      throw new TruncatedGifError();
    }
    this.offset += count;
  }

  text(count: number): string {
    this.skip(count);
    return String.fromCharCode(
      ...this.bytes.subarray(this.offset - count, this.offset),
    );
  }

  /** 길이 바이트로 시작하는 data sub-block들을 0 길이 종결자까지 넘긴다. */
  subBlocks() {
    for (let size = this.byte(); size > 0; size = this.byte()) {
      this.skip(size);
    }
  }
}
