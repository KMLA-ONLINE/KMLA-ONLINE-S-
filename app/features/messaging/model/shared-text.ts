export interface SharedContent {
  title: string;
  text: string;
  url: string;
}

/**
 * 다른 앱의 공유 시트로 받은 `title`·`text`·`url`을 메시지 초안 한 덩어리로 합친다(기능 명세 §13.24).
 *
 * 본문은 `text`이고, `url`이 그 안에 없을 때만 줄을 바꿔 덧붙인다. Android 앱 상당수가 링크를 `text`에
 * 넣어 보내므로 그대로 붙이면 같은 링크가 두 번 들어간다. 공백으로 나눈 한 덩어리가 링크와 같아야
 * 들어 있다고 본다 — 글자 일부만 보면 `…/posts/123`이 든 글에서 `…/posts/12`를 빠뜨린다. `title`은 둘 다 비었을 때만 쓴다 — 페이지
 * 제목을 링크 앞에 붙이면 링크만 있는 메시지가 아니게 되어 큼온 게시물 링크가 카드로 보이지 않는다(§13.21).
 */
export function composeSharedText({ title, text, url }: SharedContent): string {
  const body = text.trim();
  const link = url.trim();
  if (link !== "" && !body.split(/\s+/).includes(link)) {
    return body === "" ? link : `${body}\n${link}`;
  }
  return body === "" ? title.trim() : body;
}
