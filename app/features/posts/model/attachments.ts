import type {
  PostAttachment,
  PreparedCommentImage,
  PreparedPostFile,
} from "~/features/posts/model/types";
export { POST_ATTACHMENT_LIMIT } from "~/features/posts/model/constants";
import { validateSelectedFiles } from "~/features/posts/model/validation";
import { MAX_INPUT_FILE_BYTES } from "~/shared/lib/file-policy";
import {
  compressImage,
  getImageDimensions,
  isSupportedImageInput,
} from "~/shared/lib/image/compress";
const DEFAULT_IMAGE_PREPARATION_CONCURRENCY = 3;
/** 휴대폰·저사양 기기에서 한 번에 손보는 사진 수. 인코딩이 워커로 옮겨 겹침이 생겼지만 iOS는 메모리 압박에 탭을 죽이므로 데스크톱(3)만큼 주지 않는다. */
const LOW_POWER_IMAGE_PREPARATION_CONCURRENCY = 2;

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
    ? LOW_POWER_IMAGE_PREPARATION_CONCURRENCY
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
  if (!isSupportedImageInput(source))
    throw new Error("JPEG, PNG, WebP, HEIC, HEIF 사진만 선택할 수 있습니다.");
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

/** 정규화한 `photo`에서 축소본을 만든다(픽셀이 적고 EXIF·방향이 이미 처리됐다). 실패해도 던지지 않는다 — 축소본은 게시물의 일부가 아니다. */
async function createThumbnail(
  file: File,
  signal?: AbortSignal,
): Promise<File | null> {
  return compressImage(file, "thumbnail", signal).catch(() => null);
}

interface PostFilePreparationOptions {
  /** 고른 파일의 key를 고른 순서대로 준비 시작 전에 알린다. 압축 완료 순서(`onPrepared`)는 고른 순서가 아니다. */
  onQueued?: (keys: string[]) => void;
  onPrepared?: (file: PreparedPostFile) => void;
  onError?: (error: Error, key: string) => void;
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

  // 첫 `await` 전에 동기적으로 알린다. 앞선 선택이 아직 준비 중이어도 이번 선택의 자리는
  // 그 뒤에 통째로 잡힌다.
  const keys = selected.map(() => crypto.randomUUID());
  options.onQueued?.(keys);

  const prepared = new Array<PreparedPostFile>(selected.length);
  const errors: Error[] = [];

  await Promise.all(
    selected.map((source, index) => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      options.signal?.addEventListener("abort", abort, { once: true });
      const prepare = async () => {
        try {
          const isImage = isSupportedImageInput(source);
          if (selection === "image" && !isImage)
            throw new Error(
              `JPEG, PNG, WebP, HEIC, HEIF 사진만 선택할 수 있습니다: ${source.name}`,
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
            key: keys[index],
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
          options.onError?.(itemError, keys[index]);
          return undefined;
        }
      };
      const preparation = isSupportedImageInput(source)
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

/** signed URL에 `download` 쿼리를 붙인다. Storage는 다른 출처라 `<a download>`가 무시되므로, 서버가 `Content-Disposition: attachment`를 내리게 한다. */
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
