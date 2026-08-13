import type { PreparedPostFile } from "~/features/posts/model/types";
import { validateSelectedFiles } from "~/features/posts/model/validation";
import { compressImage } from "~/shared/lib/image/compress";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function preparePostFiles(
  selected: File[],
  currentCount: number,
  selection: "image" | "file" | "mixed",
): Promise<PreparedPostFile[]> {
  const error = validateSelectedFiles(selected, currentCount);
  if (error) throw new Error(error);

  return Promise.all(
    selected.map(async (source) => {
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
      return {
        key: crypto.randomUUID(),
        file,
        kind: isImage ? "image" : "file",
        width,
        height,
        previewUrl: isImage ? URL.createObjectURL(file) : null,
      };
    }),
  );
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

export function releasePostFile(file: PreparedPostFile): void {
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}
