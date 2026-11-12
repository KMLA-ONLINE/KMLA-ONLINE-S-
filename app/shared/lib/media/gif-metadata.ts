/** 반복 재생 횟수를 담는 application extension. 이것만 남기고 나머지 application 데이터는 지운다. */
const LOOP_APPLICATIONS = new Set(["NETSCAPE2.0", "ANIMEXTS1.0"]);

const EXTENSION = 0x21;
const IMAGE = 0x2c;
const TRAILER = 0x3b;
const GRAPHIC_CONTROL = 0xf9;
const APPLICATION = 0xff;

/**
 * GIF에서 그림에 쓰이지 않는 블록을 지운다. 주석, plain text, 반복 정보가 아닌 application 데이터(XMP,
 * ICC 등)가 대상이다. 프레임과 색상표, 프레임 지연은 바이트 그대로 둬 화질이 바뀌지 않는다(기능 명세
 * §18.7). GIF가 아니거나 끝까지 읽을 수 없으면 던진다.
 */
export function stripGifMetadata(source: Uint8Array): Uint8Array<ArrayBuffer> {
  const reader = new GifReader(source);
  const signature = reader.text(6);
  if (signature !== "GIF87a" && signature !== "GIF89a") {
    throw new Error("Not a GIF");
  }
  reader.skip(4);
  const packed = reader.byte();
  reader.skip(2);
  if (packed & 0x80) reader.skip(colorTableBytes(packed));
  const kept: Uint8Array[] = [source.subarray(0, reader.offset)];

  for (;;) {
    const start = reader.offset;
    const introducer = reader.byte();
    if (introducer === TRAILER) {
      kept.push(source.subarray(start, reader.offset));
      break;
    }
    if (introducer === IMAGE) {
      reader.skip(8);
      const local = reader.byte();
      if (local & 0x80) reader.skip(colorTableBytes(local));
      reader.skip(1);
      reader.subBlocks();
      kept.push(source.subarray(start, reader.offset));
      continue;
    }
    if (introducer !== EXTENSION) throw new Error("Unknown GIF block");

    const label = reader.byte();
    let keep = label === GRAPHIC_CONTROL;
    if (label === APPLICATION) {
      const size = reader.byte();
      keep = size === 11 && LOOP_APPLICATIONS.has(reader.text(11));
      if (size !== 11) reader.skip(size);
    }
    reader.subBlocks();
    if (keep) kept.push(source.subarray(start, reader.offset));
  }

  const result = new Uint8Array(
    kept.reduce((sum, part) => sum + part.length, 0),
  );
  let offset = 0;
  for (const part of kept) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

function colorTableBytes(packed: number): number {
  return 3 * 2 ** ((packed & 0x07) + 1);
}

class GifReader {
  offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  byte(): number {
    if (this.offset >= this.bytes.length) throw new Error("Truncated GIF");
    return this.bytes[this.offset++];
  }

  skip(count: number) {
    if (this.offset + count > this.bytes.length) {
      throw new Error("Truncated GIF");
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
