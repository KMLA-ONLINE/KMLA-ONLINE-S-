import { isSupportedImageInput } from "~/shared/lib/image/compress";

/**
 * 붙여넣기로 받을 이미지 파일. 첨부할 수 있는 형식만 고르고, 글자를 붙여넣는 경우면 빈 배열이다.
 *
 * Excel·Word·PowerPoint는 셀이나 문단을 복사할 때 그 영역을 찍은 PNG를 함께 싣는다. 이미지만 보고
 * 받으면 표를 붙여넣었는데 사진이 첨부된다. 그렇다고 `text/plain`이 있다고 버리면 Finder의 파일
 * 복사(파일 이름)나 Slack·Notion의 이미지 복사(주소)까지 막힌다. 그래서 HTML에 보이는 글자가
 * 있는지로 가른다 — 문서 편집기는 언제나 표·문단 HTML을 싣고, 이미지 복사의 HTML은 `<img>`뿐이다.
 */
export function clipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data || hasVisibleHtmlText(data.getData("text/html"))) return [];
  return Array.from(data.items).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file && isSupportedImageInput(file) ? [file] : [];
  });
}

function hasVisibleHtmlText(html: string): boolean {
  if (!html) return false;
  const body = new DOMParser().parseFromString(html, "text/html").body;
  return Boolean(body.textContent.trim());
}
