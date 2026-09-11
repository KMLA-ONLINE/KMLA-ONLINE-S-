import type {
  PostAttachment,
  PreparedCommentImage,
  PreparedPostFile,
} from "~/features/posts/model/types";
export { POST_ATTACHMENT_LIMIT } from "~/features/posts/model/constants";
import { validateSelectedFiles } from "~/features/posts/model/validation";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import { compressImage } from "~/shared/lib/image/compress";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_IMAGE_PREPARATION_CONCURRENCY = 2;

/** 업로드 파이프라인이 사진을 webp로 정규화하므로, 이미지인지 아닌지는 이 한 줄로 갈린다. */
const IMAGE_MIME = "image/webp";

export function splitPostAttachments(attachments: PostAttachment[]) {
  return {
    images: attachments.filter((item) => item.mime_type === IMAGE_MIME),
    files: attachments.filter((item) => item.mime_type !== IMAGE_MIME),
  };
}

export async function prepareCommentImage(
  source: File,
): Promise<PreparedCommentImage> {
  if (!IMAGE_TYPES.has(source.type))
    throw new Error("JPEG, PNG, WebP 사진만 선택할 수 있습니다.");
  if (source.size > MAX_INPUT_FILE_BYTES)
    throw new Error(`이미지는 30MB 이하여야 합니다: ${source.name}`);

  const file = await compressImage(source, "photo");
  const bitmap = await createImageBitmap(file);
  const width = bitmap.width;
  const height = bitmap.height;
  bitmap.close();
  return {
    key: crypto.randomUUID(),
    file,
    // 댓글 이미지는 목록에 깔리지 않고 게시물을 열어야 보이므로 축소본을 만들지 않는다.
    thumbnail: null,
    kind: "image",
    width,
    height,
    previewUrl: URL.createObjectURL(file),
  };
}

/**
 * 이미 `photo`로 정규화한 이미지에서 축소본을 만든다.
 *
 * 원본이 아니라 압축 결과를 입력으로 쓰는 이유는 디코딩할 픽셀이 훨씬 적어 빠르고,
 * `photo`가 이미 EXIF를 털고 방향을 굽혔기 때문이다. 여기서 한 번 더 굽힐 것이 없다.
 *
 * 실패해도 던지지 않는다. 축소본은 데이터를 아끼는 수단이지 게시물의 일부가 아니라서,
 * 만들지 못했다고 업로드를 막을 이유가 없다.
 */
async function createThumbnail(file: File): Promise<File | null> {
  return compressImage(file, "thumbnail").catch(() => null);
}

export async function preparePostFiles(
  selected: File[],
  currentCount: number,
  selection: "image" | "file" | "mixed",
): Promise<PreparedPostFile[]> {
  const error = validateSelectedFiles(selected, currentCount);
  if (error) throw new Error(error);

  const prepared = new Array<PreparedPostFile>(selected.length);
  let nextIndex = 0;

  // Re-encoding large camera images is CPU and memory intensive on mobile.
  async function worker(): Promise<void> {
    while (nextIndex < selected.length) {
      const index = nextIndex;
      nextIndex += 1;
      const source = selected[index];
      const isImage = IMAGE_TYPES.has(source.type);
      if (selection === "image" && !isImage)
        throw new Error(
          `JPEG, PNG, WebP 사진만 선택할 수 있습니다: ${source.name}`,
        );
      if (source.type.startsWith("image/") && !isImage)
        throw new Error(`지원하지 않는 이미지 형식입니다: ${source.name}`);

      const file = isImage ? await compressImage(source, "photo") : source;
      let width: number | null = null;
      let height: number | null = null;
      if (isImage) {
        const bitmap = await createImageBitmap(file);
        width = bitmap.width;
        height = bitmap.height;
        bitmap.close();
      }
      prepared[index] = {
        key: crypto.randomUUID(),
        file,
        thumbnail: isImage ? await createThumbnail(file) : null,
        kind: isImage ? "image" : "file",
        width,
        height,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
      };
    }
  }

  const isIOS =
    typeof navigator !== "undefined" &&
    (/^(?:iPad|iPhone|iPod)$/.test(navigator.platform) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
  await Promise.all(
    Array.from(
      {
        length: Math.min(
          isIOS ? 1 : DEFAULT_IMAGE_PREPARATION_CONCURRENCY,
          selected.length,
        ),
      },
      worker,
    ),
  );

  return prepared;
}

/**
 * Supabase Storage의 signed URL에 `download` 쿼리를 붙인다.
 *
 * `<a download>`는 같은 출처에서만 동작한다. 첨부는 Storage 도메인에서 오므로 브라우저가
 * 속성을 무시하고 그냥 탭에서 열어버린다(PDF는 뷰어로, 나머지는 빈 화면으로). Storage가
 * 이 쿼리를 보면 `Content-Disposition: attachment`를 붙여 내려주므로, 저장 여부와 파일명
 * 모두 서버 응답이 결정하게 된다.
 */
export function toAttachmentDownloadUrl(
  signedUrl: string,
  filename: string,
): string {
  const url = new URL(signedUrl);
  url.searchParams.set("download", filename);
  return url.toString();
}

/** 원본 이름을 노출하지 않고 이미지 UUID로 안정적인 다운로드 이름을 만든다. */
export function imageDownloadName(imageId: string): string {
  return `${imageId}.webp`;
}

export function releasePostFile(file: PreparedPostFile): void {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}
