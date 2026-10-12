/** 일치한 곳 앞에 남길 글자 수. 결과는 두 줄까지라 이보다 뒤에서 찾으면 앞을 줄인다. */
const LEADING_CONTEXT = 16;

/**
 * 검색 결과 한 줄에 보일 본문 조각. 서버와 같이 대소문자와 공백 차이를 무시하고 처음 일치한 곳을
 * 찾는다(기능 명세 §13.13). 일치한 곳이 본문 뒤쪽이면 앞을 `…`로 줄여 두 줄 안에 보이게 한다.
 * 찾지 못하면 `match`가 비어 있고 본문을 그대로 쓴다.
 */
export function searchExcerpt(
  body: string,
  term: string,
): { before: string; match: string; after: string } {
  const characters = Array.from(term.replace(/\s+/g, ""));
  if (characters.length === 0) return { before: body, match: "", after: "" };
  const pattern = new RegExp(characters.map(escapeRegExp).join("\\s*"), "iu");
  const found = pattern.exec(body);
  if (!found) return { before: body, match: "", after: "" };

  const end = found.index + found[0].length;
  const leading = Array.from(body.slice(0, found.index));
  const before =
    leading.length > LEADING_CONTEXT
      ? `…${leading.slice(-LEADING_CONTEXT).join("").trimStart()}`
      : leading.join("");
  return { before, match: found[0], after: body.slice(end) };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
