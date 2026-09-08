import { Upload } from "tus-js-client";

import { env } from "~/shared/lib/env";
import { createSignedUrls } from "~/shared/supabase/signed-urls";
import { STORAGE_UPLOAD_CACHE_CONTROL } from "~/shared/supabase/storage";
import { getSupabase } from "~/shared/supabase/client";

const BUCKET = "post-attachments";
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
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const {
    data: { session },
  } = await getSupabase().auth.getSession();
  if (!session) throw new Error("로그인 세션을 확인할 수 없습니다.");

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
            "supabase-post-attachment",
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
        bucketName: BUCKET,
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

export async function uploadPostAttachment(
  path: string,
  file: File,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  if (file.size > RESUMABLE_THRESHOLD) {
    await uploadResumable(path, file, onProgress, signal);
    return;
  }
  onProgress?.(0);
  const { error } = await getSupabase()
    .storage.from(BUCKET)
    .upload(path, file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: STORAGE_UPLOAD_CACHE_CONTROL,
      upsert: false,
    });
  if (error) throw error;
  onProgress?.(1);
}

export function createPostAttachmentUrls(
  paths: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  return createSignedUrls(BUCKET, paths);
}
