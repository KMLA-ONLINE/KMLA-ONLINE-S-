import { env } from "~/shared/lib/env";
import { STORAGE_UPLOAD_CACHE_CONTROL } from "~/shared/supabase/storage";
import { getSupabase } from "~/shared/supabase/client";

const RESUMABLE_THRESHOLD = 6 * 1024 * 1024;

function resumableEndpoint(): string {
  const url = new URL(env.supabaseUrl);
  if (url.hostname.endsWith(".supabase.co")) {
    const projectRef = url.hostname.split(".")[0];
    return `https://${projectRef}.storage.supabase.co/storage/v1/upload/resumable`;
  }
  return `${url.origin}/storage/v1/upload/resumable`;
}

async function uploadResumable(
  bucket: string,
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  if (!session) throw new Error("로그인 세션을 확인할 수 없습니다.");
  // 6MB를 넘는 파일에서만 쓰므로 피드 첫 로딩 번들에서 뺀다.
  const { Upload } = await import("tus-js-client");

  await new Promise<void>((resolve, reject) => {
    const endpoint = resumableEndpoint();
    const abort = () => {
      void upload.abort();
      reject(new DOMException("Upload aborted", "AbortError"));
    };
    const upload = new Upload(file, {
      endpoint,
      fingerprint: () =>
        Promise.resolve(
          [
            "supabase-upload",
            bucket,
            endpoint,
            path,
            file.name,
            file.type,
            file.size,
            file.lastModified,
          ].join("-"),
        ),
      retryDelays: [0, 3_000, 5_000, 10_000, 20_000],
      headers: {
        authorization: `Bearer ${session.access_token}`,
        apikey: env.supabasePublishableKey,
      },
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      chunkSize: RESUMABLE_THRESHOLD,
      metadata: {
        bucketName: bucket,
        objectName: path,
        contentType: file.type || "application/octet-stream",
        cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
      },
      onError: (error) => {
        signal?.removeEventListener("abort", abort);
        reject(error);
      },
      onProgress: (uploaded, total) => onProgress?.(uploaded / total),
      onSuccess: () => {
        signal?.removeEventListener("abort", abort);
        resolve();
      },
    });
    if (signal?.aborted) return abort();
    signal?.addEventListener("abort", abort, { once: true });
    void upload.findPreviousUploads().then(
      (previous) => {
        if (signal?.aborted) return;
        if (previous[0]) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      },
      (error) => {
        signal?.removeEventListener("abort", abort);
        reject(
          error instanceof Error
            ? error
            : new Error("재개 가능한 업로드를 시작하지 못했습니다."),
        );
      },
    );
  });
}

/**
 * 비공개 버킷에 object 하나를 올린다. 6MB를 넘으면 끊겨도 이어 올리는 resumable 업로드를 쓴다.
 * 덮어쓰지 않는다(upsert 없음). 경로는 RPC가 미리 예고한 것이어야 Storage 정책이 받아 준다.
 */
export async function uploadStorageObject(
  bucket: string,
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (file.size > RESUMABLE_THRESHOLD) {
    await uploadResumable(bucket, path, file, onProgress, signal);
    return;
  }
  onProgress?.(0);
  const { error } = await getSupabase()
    .storage.from(bucket)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
      upsert: false,
    });
  if (error) throw error;
  onProgress?.(1);
}
