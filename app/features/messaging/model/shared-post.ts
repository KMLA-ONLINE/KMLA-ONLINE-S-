export interface SharedPostLink {
  postId: string;
  /** 앱 안 게시물 상세 경로. 카드를 누르면 여기로 간다. */
  path: string;
}

/**
 * 게시물 상세 경로(`groupPostPath`·`profilePostPath`와 같은 모양). 수정 화면 `/edit`과 작성 화면
 * `posts/new`는 게시물이 아니다.
 */
const POST_DETAIL_PATH =
  /^\/(?:groups|profile)\/[^/]+\/posts\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

/**
 * 본문이 이 앱의 게시물 상세 링크 하나뿐이면 그 게시물을 돌려준다(기능 명세 §13.21). 다른 글과 섞인
 * 링크는 일반 링크로 남긴다. 다른 origin은 같은 경로여도 우리 게시물이 아니다.
 */
export function sharedPostLink(
  body: string,
  origin: string,
): SharedPostLink | null {
  const text = body.trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.origin !== origin) return null;
  const match = POST_DETAIL_PATH.exec(url.pathname);
  return match ? { postId: match[1].toLowerCase(), path: url.pathname } : null;
}

/**
 * 이 메시지를 게시물 카드로 그릴지. 버블, 대화 목록, 답장 인용이 모두 이 판정 하나를 쓴다 — 갈라지면
 * 버블에는 링크가 보이는데 목록에는 `게시물`이 뜬다. 첨부가 붙은 메시지와 삭제된 메시지는 카드가 아니다.
 */
export function sharedPostOf(
  message: {
    body: string;
    deleted?: boolean;
    /** 첨부가 하나라도 있으면 그 종류. 버블은 첨부 배열 대신 있음만 넘긴다. */
    attachmentKind?: string | null;
  },
  origin: string,
): SharedPostLink | null {
  if (message.deleted || message.attachmentKind) return null;
  return sharedPostLink(message.body, origin);
}
