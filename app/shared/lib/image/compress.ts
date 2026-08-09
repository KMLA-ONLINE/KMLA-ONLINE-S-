import imageCompression from "browser-image-compression";
// 워커는 `importScripts(libURL)`로 라이브러리를 다시 불러온다. 기본값은 jsDelivr URL이라
// (버전은 고정돼 있어도) 런타임에 외부 출처를 타게 되고, 그러면 오프라인에서 압축이 죽고
// `worker-src 'self'` CSP를 넣는 순간 함께 깨진다. Vite가 이 UMD 번들을 같은 출처 자산으로
// 내보내게 해서 URL을 직접 넘긴다 — `build-sw.mjs`의 `**/*.js` 글로브에 걸려 프리캐시된다.
import workerLibUrl from "browser-image-compression/dist/browser-image-compression.js?url";

interface CompressionPolicy {
  /** 긴 변의 상한(px). */
  maxEdge: number;
  /** 결과 용량 상한 힌트(MB). 라이브러리가 품질을 낮춰 근사한다. */
  maxSizeMB: number;
  /** 초기 품질(0 ~ 1). */
  quality: number;
}

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
  icon: { maxEdge: 512, maxSizeMB: 0.3, quality: 0.8 },
  /** 프로필·그룹 커버. 가로로 넓게 깔리는 띠. */
  banner: { maxEdge: 1600, maxSizeMB: 0.6, quality: 0.8 },
  /** 글·채팅에 첨부한 사진. 눌러서 크게 열 수 있다. */
  photo: { maxEdge: 2048, maxSizeMB: 1.5, quality: 0.8 },
} as const satisfies Record<string, CompressionPolicy>;

export type ImagePreset = keyof typeof PRESETS;

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

  const { maxEdge, maxSizeMB, quality } = PRESETS[preset];

  let compressed: Blob;
  try {
    compressed = await imageCompression(file, {
      maxWidthOrHeight: maxEdge,
      maxSizeMB,
      initialQuality: quality,
      fileType: "image/webp",
      useWebWorker: true,
      libURL: workerLibUrl,
      // 재인코딩하며 방향은 이미 반영되므로, 남는 건 떨궈야 할 메타데이터뿐이다.
      // 라이브러리 기본값이지만 이 함수의 계약이라 명시해 둔다.
      preserveExif: false,
    });
  } catch (cause) {
    throw new Error(`이미지를 처리하지 못했습니다: ${file.name}`, { cause });
  }

  // 라이브러리가 이름·타입을 원본대로 남길 수 있어, 확장자와 MIME을 webp로 맞춰 다시 감싼다.
  // 스토리지의 insert 정책이 MIME을 보므로 일관돼야 한다.
  const base = file.name.replace(/\.[^./\\]+$/, "") || "image";
  return new File([compressed], `${base}.webp`, { type: "image/webp" });
}
