import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";

interface CompressionPolicy {
  /** 긴 변의 상한(px). */
  maxEdge: number;
  /** 결과 용량 상한(byte). 초과하면 품질을 더 낮추지 않고 거부한다. */
  maxBytes: number;
  /** 초기 품질(0 ~ 1). */
  quality: number;
}

const MAX_IMAGE_PIXELS = 50_000_000;
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

/**
 * 화면에서 이미지가 **어떤 크기로 쓰이는지**로 나눈 정책. 업로드 경로는 이 중 하나를 고른다.
 *
 * 도메인이 아니라 형태로 키를 잡은 이유가 있다. v1은 `avatar`·`spaceImage`·`profileCover`·
 * `spaceCover`·`post`·`message` 여섯 이름을 뒀는데 실제 값은 세 쌍이 정확히 겹쳤다. 도메인
 * 이름은 압축 결정에 아무 정보도 더하지 않으면서 `shared/`가 spaces와 posts를 알게 만들었다.
 *
 * 새 업로드 경로에 맞는 게 없으면 임의의 숫자를 쓰지 말고 여기에 항목을 추가한다. 그 판단이
 * 이 파일 안에서 일어나는 게 요점이라, 함수도 원시 옵션을 받지 않고 이 키만 받는다.
 */
const PRESETS = {
  /** 아바타·그룹 아이콘. 목록에서 작게 뜨는 정사각. */
  icon: { maxEdge: 512, maxBytes: 1024 * 1024, quality: 0.85 },
  /** 프로필·그룹 커버. 가로로 넓게 깔리는 띠. */
  banner: { maxEdge: 2400, maxBytes: 4 * 1024 * 1024, quality: 0.85 },
  /** 글·채팅에 첨부한 사진. 눌러서 크게 열 수 있다. */
  photo: { maxEdge: 3072, maxBytes: 8 * 1024 * 1024, quality: 0.85 },
  /**
   * 목록에 까는 축소본. 피드와 그룹 게시물 목록이 이걸 그리고, 원본은 뷰어에서만 연다.
   *
   * 800px은 화면에서 필요한 값을 거꾸로 계산한 것이다. 가장 큰 자리가 모바일 전체폭 단일
   * 사진 카드(약 390 CSS px)이고, DPR 2에서 780 device px다. 그리드 타일은 그 절반 아래다.
   * `photo`가 3072px이라 같은 사진이 장당 수백 kB에서 수십 kB로 떨어진다.
   *
   * 품질이 `photo`보다 낮은 건, 이 이미지가 원래 크기의 4분의 1로 그려져 압축 흔적이
   * 눈에 덜 띄기 때문이다. 크게 볼 때는 어차피 뷰어가 원본을 연다.
   */
  thumbnail: { maxEdge: 800, maxBytes: 1024 * 1024, quality: 0.8 },
} as const satisfies Record<string, CompressionPolicy>;

export type ImagePreset = keyof typeof PRESETS;

function readPngDimensions(view: DataView): [number, number] | null {
  if (
    view.byteLength < 24 ||
    view.getUint32(0) !== 0x89504e47 ||
    view.getUint32(4) !== 0x0d0a1a0a ||
    view.getUint32(12) !== 0x49484452
  )
    return null;
  return [view.getUint32(16), view.getUint32(20)];
}

function readJpegDimensions(view: DataView): [number, number] | null {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;

  let offset = 2;
  while (offset + 8 < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < view.byteLength && view.getUint8(offset) === 0xff)
      offset += 1;
    if (offset >= view.byteLength) return null;

    const marker = view.getUint8(offset);
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= view.byteLength) return null;

    const length = view.getUint16(offset);
    if (length < 2 || offset + length > view.byteLength) return null;
    if (JPEG_START_OF_FRAME_MARKERS.has(marker) && length >= 7)
      return [view.getUint16(offset + 5), view.getUint16(offset + 3)];
    offset += length;
  }
  return null;
}

function readUint24LittleEndian(view: DataView, offset: number): number {
  return (
    view.getUint8(offset) |
    (view.getUint8(offset + 1) << 8) |
    (view.getUint8(offset + 2) << 16)
  );
}

function readWebpDimensions(view: DataView): [number, number] | null {
  if (
    view.byteLength < 20 ||
    view.getUint32(0) !== 0x52494646 ||
    view.getUint32(8) !== 0x57454250
  )
    return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const chunkType = view.getUint32(offset);
    const chunkSize = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + chunkSize > view.byteLength) return null;

    if (chunkType === 0x56503858 && chunkSize >= 10)
      return [
        readUint24LittleEndian(view, payload + 4) + 1,
        readUint24LittleEndian(view, payload + 7) + 1,
      ];
    if (
      chunkType === 0x5650384c &&
      chunkSize >= 5 &&
      view.getUint8(payload) === 0x2f
    ) {
      const b1 = view.getUint8(payload + 1);
      const b2 = view.getUint8(payload + 2);
      const b3 = view.getUint8(payload + 3);
      const b4 = view.getUint8(payload + 4);
      return [
        1 + (((b2 & 0x3f) << 8) | b1),
        1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6)),
      ];
    }
    if (
      chunkType === 0x56503820 &&
      chunkSize >= 10 &&
      view.getUint8(payload + 3) === 0x9d &&
      view.getUint8(payload + 4) === 0x01 &&
      view.getUint8(payload + 5) === 0x2a
    )
      return [
        view.getUint16(payload + 6, true) & 0x3fff,
        view.getUint16(payload + 8, true) & 0x3fff,
      ];

    offset = payload + chunkSize + (chunkSize % 2);
  }
  return null;
}

async function readImageDimensions(
  file: File,
): Promise<[number, number] | null> {
  const view = new DataView(await file.arrayBuffer());
  if (file.type === "image/png") return readPngDimensions(view);
  if (file.type === "image/jpeg") return readJpegDimensions(view);
  if (file.type === "image/webp") return readWebpDimensions(view);
  return null;
}

/** 압축 워커를 열기 전에 원본 크기를 제한한다. 지원 포맷은 전체 디코딩 없이 헤더를 읽는다. */
export async function validateImageInput(file: File): Promise<void> {
  if (!file.type.startsWith("image/")) return;
  if (file.size > MAX_INPUT_FILE_BYTES)
    throw new Error(`이미지는 30MB 이하여야 합니다: ${file.name}`);

  const dimensions = await readImageDimensions(file);
  if (dimensions) {
    if (dimensions[0] * dimensions[1] > MAX_IMAGE_PIXELS)
      throw new Error(`이미지는 50메가픽셀 이하여야 합니다: ${file.name}`);
    return;
  }
  if (typeof createImageBitmap !== "function") return;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
  } catch (cause) {
    throw new Error(`이미지를 처리하지 못했습니다: ${file.name}`, { cause });
  }

  try {
    if (bitmap.width * bitmap.height > MAX_IMAGE_PIXELS)
      throw new Error(`이미지는 50메가픽셀 이하여야 합니다: ${file.name}`);
  } finally {
    bitmap.close();
  }
}

/**
 * 업로드 전 이미지 정규화의 단일 진입점. 아바타든 글 첨부든 채팅 사진이든 전부 여기를 거친다.
 *
 * **이미지를 받으면 반드시 다시 인코딩한 파일을 주거나, 던진다.** 원본을 그대로 통과시키는
 * 경로는 없다. 재인코딩이 압축이기 전에 세 가지 보장이기 때문이다.
 *
 * - EXIF 제거. 휴대폰 사진에는 GPS 좌표와 기기 정보가 들어 있고, 이 서비스에서 그게 새면
 *   글쓴이의 위치가 새는 것과 같다. 원본을 통과시키면 이 보장만 조용히 사라진다.
 * - 포맷 통일(WebP). 스토리지 정책과 렌더 경로가 한 가지 MIME만 다루면 된다.
 * - 치수 상한. 프리셋의 `maxEdge`를 넘는 이미지가 올라가지 않는다.
 *
 * 그래서 "압축했더니 원본보다 커졌다"는 경우에도 재인코딩한 쪽을 준다. 이미 작은 파일에서
 * 몇 KB 손해 보는 대신 위 세 보장이 예외 없이 성립한다.
 *
 * 이미지가 아닌 첨부(pdf·hwp·문서)는 정규화 대상이 아니므로 손대지 않고 그대로 돌려준다.
 *
 * @throws 이미지인데 재인코딩에 실패한 경우. 호출부가 사용자에게 알리고 업로드를 멈춘다 —
 *   조용히 원본을 올리면 위 보장이 깨진 파일이 서버에 남는다.
 */
export async function compressImage(
  file: File,
  preset: ImagePreset,
): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  const { maxEdge, maxBytes, quality } = PRESETS[preset];
  await validateImageInput(file);

  const compressed = await imageCompression(file, {
    maxWidthOrHeight: maxEdge,
    initialQuality: quality,
    fileType: "image/webp",
    useWebWorker: true,
    libURL: workerLibUrl,
    preserveExif: false,
    alwaysKeepResolution: false,
  }).catch((cause) => {
    throw new Error(`이미지를 처리하지 못했습니다: ${file.name}`, { cause });
  });
  if (compressed.size > maxBytes)
    throw new Error(`처리한 이미지가 용량 제한을 초과합니다: ${file.name}`);

  // 라이브러리가 이름·타입을 원본대로 남길 수 있어, 확장자와 MIME을 webp로 맞춰 다시 감싼다.
  // 스토리지의 insert 정책이 MIME을 보므로 일관돼야 한다.
  const base = file.name.replace(/\.[^./\\]+$/, "") || "image";
  return new File([compressed], `${base}.webp`, {
    type: "image/webp",
    lastModified: file.lastModified,
  });
}
import imageCompression from "browser-image-compression";
import workerLibUrl from "browser-image-compression/dist/browser-image-compression.js?url";
