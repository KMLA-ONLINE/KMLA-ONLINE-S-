/**
 * 휴대폰·태블릿에서 파일을 앱이 직접 받아 저장한다.
 *
 * 링크로 받으면 앱은 다운로드가 시작됐는지도 끝났는지도 모른다. Android 설치 앱(standalone)은 완료
 * 알림이 뜨지 않거나 묻혀서, 사용자가 같은 파일을 몇 번이고 다시 받았다. 그래서 휴대폰에서는 앱이
 * 받으며 진행을 보여 주고, 다 받으면 한 번 더 탭해 저장하게 한다(iOS는 공유 시트, Android는 다운로드
 * 폴더). 탭을 둘로 나누는 것은 받는 사이 첫 탭의 사용자 활성화가 만료되면 `navigator.share`와 연속
 * 다운로드가 막히기 때문이다.
 *
 * 데스크톱은 브라우저 다운로드 UI가 있으므로 링크의 기본 다운로드를 그대로 쓴다.
 *
 * `navigator`·`document`를 읽으므로 이벤트 핸들러 안에서만 부른다.
 */
import { isAndroid, isIOS } from "~/shared/lib/install-platform";

export interface DownloadTarget {
  url: string;
  fileName: string;
}

/**
 * Storage의 MIME type은 올린 사람이 정한 값이라 믿지 않는다. 공유 받을 앱이 형식을 알도록 확장자로
 * 정하고, 모르는 형식은 `application/octet-stream`으로 둔다. Android Chrome은 그런 파일을 공유하지
 * 못하므로 `canShareFiles`가 거절한다.
 */
const TYPE_BY_EXTENSION: Record<string, string> = {
  webp: "image/webp",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  ogg: "audio/ogg",
  mp4: "video/mp4",
  webm: "video/webm",
};

/** 블롭 주소를 브라우저가 읽어 가기 전에 거두지 않도록 넉넉히 둔다. */
const REVOKE_DELAY_MS = 60_000;

/** 한 번에 몰아 저장하면 브라우저가 뒤의 것을 버리므로 간격을 둔다. */
const SAVE_INTERVAL_MS = 400;

/** 이 기기에서 링크 대신 앱이 받아 저장하는가. */
export function usesManagedDownload(): boolean {
  return isIOS() || isAndroid();
}

export function fileTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  return TYPE_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * 모든 파일을 받아 `File`로 돌려준다. `onProgress`는 0~1의 비율이며, 크기를 모르는 응답이 하나라도
 * 있으면 `null`이다.
 */
export async function fetchFiles(
  targets: readonly DownloadTarget[],
  {
    signal,
    onProgress,
  }: { signal?: AbortSignal; onProgress?: (ratio: number | null) => void } = {},
): Promise<File[]> {
  const totals = targets.map(() => 0);
  const loaded = targets.map(() => 0);

  function report() {
    if (!onProgress) return;
    if (totals.some((total) => total === 0)) {
      onProgress(null);
      return;
    }
    const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
    onProgress(Math.min(1, sum(loaded) / sum(totals)));
  }

  return Promise.all(
    targets.map(async (target, index) => {
      const response = await fetch(target.url, { signal });
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status}`);
      }
      totals[index] = Number(response.headers.get("content-length")) || 0;

      const chunks: BlobPart[] = [];
      const reader = response.body?.getReader();
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded[index] += value.byteLength;
          report();
        }
      } else {
        const buffer = await response.arrayBuffer();
        chunks.push(buffer);
        loaded[index] += buffer.byteLength;
        report();
      }

      return new File(chunks, target.fileName, {
        type: fileTypeFor(target.fileName),
      });
    }),
  );
}

export function canShareFiles(files: File[]): boolean {
  return (
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function" &&
    navigator.canShare({ files })
  );
}

/** 공유 시트를 연다. 사용자가 닫았으면 `false`다. */
export async function shareFiles(files: File[]): Promise<boolean> {
  try {
    await navigator.share({ files });
    return true;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return false;
    }
    throw error;
  }
}

/** 기기의 다운로드 폴더로 저장한다. 같은 출처 Blob이라 파일 이름이 유지된다. */
export function saveFiles(files: File[]): void {
  files.forEach((file, order) => {
    window.setTimeout(() => {
      const url = URL.createObjectURL(file);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.name;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
    }, order * SAVE_INTERVAL_MS);
  });
}
