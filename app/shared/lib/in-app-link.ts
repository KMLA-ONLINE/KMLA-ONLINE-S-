/**
 * 사용자가 쓴 URL이 이 앱 안을 가리키면 라우터로 갈 경로를 돌려준다. 앱 밖이면 `null`이다.
 *
 * `//`로 시작하는 경로는 앱 밖으로 친다. `https://kmla.online//example.com`의 경로를 라우터에
 * 넘기면 프로토콜 상대 URL로 읽어 다른 사이트로 간다.
 */
export function inAppPath(href: string, origin: string): string | null {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname.startsWith("//")) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
