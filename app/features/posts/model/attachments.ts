import type {
  PostAttachment,
  PreparedCommentImage,
  PreparedPostFile,
} from "~/features/posts/model/types";
export { POST_ATTACHMENT_LIMIT } from "~/features/posts/model/constants";
import { validateSelectedFiles } from "~/features/posts/model/validation";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import { compressImage, getImageDimensions } from "~/shared/lib/image/compress";

const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const DEFAULT_IMAGE_PREPARATION_CONCURRENCY = 3;

/** 업로드 파이프라인이 사진을 webp로 정규화하므로, 이미지인지 아닌지는 이 한 줄로 갈린다. */
const IMAGE_MIME = "image/webp";

interface PreparationTask {
  run: () => Promise<void>;
  resolve: () => void;
  reject: (reason: unknown) => void;
}

const preparationQueue: PreparationTask[] = [];
let activePreparations = 0;

function imagePreparationConcurrency(): number {
  if (typeof navigator === "undefined")
    return DEFAULT_IMAGE_PREPARATION_CONCURRENCY;
  const isIOS =
    /^(?:iPad|iPhone|iPod)$/.test(navigator.platform) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isLowPowerTouchDevice =
    navigator.maxTouchPoints > 0 &&
    (!navigator.hardwareConcurrency || navigator.hardwareConcurrency <= 4);
  return isIOS || isLowPowerTouchDevice
    ? 1
    : DEFAULT_IMAGE_PREPARATION_CONCURRENCY;
}

function drainPreparationQueue(): void {
  while (
    activePreparations < imagePreparationConcurrency() &&
    preparationQueue.length > 0
  ) {
    const task = preparationQueue.shift()!;
    activePreparations += 1;
    void task
      .run()
      .then(task.resolve, task.reject)
      .finally(() => {
        activePreparations -= 1;
        drainPreparationQueue();
      });
  }
}

function enqueueImagePreparation<T>(
  run: () => Promise<T>,
  prioritize = false,
): Promise<T> {
  const promise = new Promise<T>((resolve, reject) => {
    let result!: T;
    const task: PreparationTask = {
      run: async () => {
        result = await run();
      },
      resolve: () => resolve(result),
      reject,
    };
    if (prioritize) preparationQueue.unshift(task);
    else preparationQueue.push(task);
  });
  drainPreparationQueue();
  return promise;
}

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
  const [width, height] = await getImageDimensions(file);
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
async function createThumbnail(
  file: File,
  signal?: AbortSignal,
): Promise<File | null> {
  return compressImage(file, "thumbnail", signal).catch(() => null);
}

interface PostFilePreparationOptions {
  onPrepared?: (file: PreparedPostFile) => void;
  onError?: (error: Error) => void;
  signal?: AbortSignal;
}

export async function preparePostFiles(
  selected: File[],
  currentCount: number,
  selection: "image" | "file" | "mixed",
  options: PostFilePreparationOptions = {},
): Promise<PreparedPostFile[]> {
  const error = validateSelectedFiles(selected, currentCount);
  if (error) throw new Error(error);

  const prepared = new Array<PreparedPostFile>(selected.length);
  const errors: Error[] = [];

  await Promise.all(
    selected.map((source, index) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const prepare = async () => {
        try {
          const isImage = IMAGE_TYPES.has(source.type);
          if (selection === "image" && !isImage)
            throw new Error(
              `JPEG, PNG, WebP 사진만 선택할 수 있습니다: ${source.name}`,
            );
          if (source.type.startsWith("image/") && !isImage)
            throw new Error(`지원하지 않는 이미지 형식입니다: ${source.name}`);

          const file = isImage
            ? await compressImage(source, "photo", controller.signal)
            : source;
          const [width, height] = isImage
            ? await getImageDimensions(file, controller.signal)
            : [null, null];
          const item: PreparedPostFile = {
            key: crypto.randomUUID(),
            file,
            thumbnail: null,
            kind: isImage ? "image" : "file",
            width,
            height,
            previewUrl: isImage ? URL.createObjectURL(file) : null,
            abortPreparation: () => controller.abort(),
          };
          if (isImage) {
            item.thumbnailPromise = enqueueImagePreparation(async () => {
              const thumbnail = await createThumbnail(file, controller.signal);
              item.thumbnail = thumbnail;
              return thumbnail;
            }, true);
          }
          prepared[index] = item;
          options.onPrepared?.(item);
          return item;
        } catch (cause) {
          const itemError =
            cause instanceof Error
              ? cause
              : new Error("파일을 준비하지 못했습니다.");
          errors.push(itemError);
          options.onError?.(itemError);
          return undefined;
        }
      };
      const preparation = IMAGE_TYPES.has(source.type)
        ? enqueueImagePreparation(prepare).then((item) =>
            item?.thumbnailPromise?.then(() => undefined),
          )
        : prepare();
      return preparation.finally(() =>
        options.signal?.removeEventListener("abort", abort),
      );
    }),
  );

  if (errors[0]) throw errors[0];

  return prepared.filter((item): item is PreparedPostFile => Boolean(item));
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
  file.abortPreparation?.();
  if (file.previewUrl) URL.revokeObjectURL(file.previewUrl);
}
