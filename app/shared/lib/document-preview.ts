/**
 * 폰에서 첨부 문서를 탭하면 내려받는 대신 바로 연다.
 *
 * 폰은 내려받은 파일을 그 자리에서 열어 주지 않는다 — iOS는 '파일' 앱 다운로드 폴더로, Android는
 * 잠깐 뜨는 알림으로만 알린다. 그래서 브라우저가 직접 보여 줄 수 있는 형식은 열어서 보여 주고,
 * 저장은 열린 화면의 공유·저장 기능에 맡긴다.
 *
 * Storage 버킷은 모든 MIME type을 받으므로 signed URL을 그대로 inline으로 열면 위장한 HTML이
 * 렌더링될 수 있다. 내려받아 앞부분이 확장자와 맞는지 보고, 통제된 MIME type의 Blob으로만 연다.
 *
 * `navigator`·`window`를 읽으므로 이벤트 핸들러 안에서만 부른다.
 */
import { isAndroid, isIOS } from "~/shared/lib/install-platform";

const PDF = "application/pdf";
const XLSX =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const XLS = "application/vnd.ms-excel";

const SIGNATURES: Record<string, { type: string; magic: readonly number[] }> = {
  pdf: { type: PDF, magic: [0x25, 0x50, 0x44, 0x46, 0x2d] },
  xlsx: { type: XLSX, magic: [0x50, 0x4b, 0x03, 0x04] },
  xls: {
    type: XLS,
    magic: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1],
  },
};

// Android Chrome은 엑셀을 열지 못해 Blob을 이름 없는 파일로 내려받는다. 그보다는 원래 이름의 다운로드가 낫다.
const ANDROID_PREVIEW = new Set(["pdf"]);

/** 블롭 주소를 연 탭이 읽어 가기 전에 거두지 않도록 넉넉히 둔다. */
const REVOKE_DELAY_MS = 60_000;

function extensionOf(fileName: string): string | null {
  const dot = fileName.lastIndexOf(".");
  return dot > 0 ? fileName.slice(dot + 1).toLowerCase() : null;
}

/** 확장자와 앞부분 바이트가 맞으면 Blob에 붙일 MIME type, 아니면 `null`. */
export function sniffPreviewableDocument(
  fileName: string,
  head: Uint8Array,
): string | null {
  const extension = extensionOf(fileName);
  const signature = extension ? SIGNATURES[extension] : undefined;
  if (!signature) return null;
  return signature.magic.every((byte, index) => head[index] === byte)
    ? signature.type
    : null;
}

/** 이 기기에서 탭하면 내려받는 대신 열어 줄 파일인가. 데스크톱은 늘 내려받는다. */
export function shouldPreviewDocument(fileName: string): boolean {
  const extension = extensionOf(fileName);
  if (!extension || !(extension in SIGNATURES)) return false;
  if (isIOS()) return true;
  return isAndroid() && ANDROID_PREVIEW.has(extension);
}

/** 다운로드 링크의 클릭 핸들러. 열어 줄 파일이 아니면 링크의 기본 다운로드를 그대로 둔다. */
export function previewDocumentOnClick(
  event: { preventDefault(): void },
  file: { url: string; downloadUrl: string; fileName: string },
): void {
  if (!shouldPreviewDocument(file.fileName)) return;
  event.preventDefault();
  void openDocumentPreview(file);
}

/**
 * 새 탭을 먼저 열고, 내려받아 확인한 Blob 주소로 옮긴다. 내려받는 사이 탭을 열면 사용자 탭에서
 * 시간이 지나 팝업으로 막힌다. 열지 못하면 탭을 닫고 원래 다운로드로 돌아간다.
 */
export async function openDocumentPreview(
  {
    url,
    downloadUrl,
    fileName,
  }: { url: string; downloadUrl: string; fileName: string },
  fallback: (href: string) => void = (href) => window.location.assign(href),
): Promise<void> {
  const tab = window.open("", "_blank");
  if (!tab) {
    fallback(downloadUrl);
    return;
  }
  tab.opener = null;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Preview failed: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const type = sniffPreviewableDocument(
      fileName,
      new Uint8Array(buffer.slice(0, 8)),
    );
    if (!type) throw new Error("Preview format mismatch");

    const blobUrl = URL.createObjectURL(new Blob([buffer], { type }));
    tab.location.href = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), REVOKE_DELAY_MS);
  } catch {
    tab.close();
    fallback(downloadUrl);
  }
}
