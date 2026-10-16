// 학교 인트라넷 공지 게시판(board_id=22)의 목록 HTML과 상세 응답을 읽는다. Deno 전용 API를 쓰지 않아 Vitest가
// 그대로 불러 검증한다.

export interface SchoolNotice {
  postId: number;
  category: string;
  title: string;
  author: string;
  /** `YYYY-MM-DD` */
  postedOn: string;
  hasAttachment: boolean;
}

export interface SchoolNoticeAttachment {
  attachmentId: number;
  name: string;
  size: number;
}

export interface SchoolNoticeDetail {
  /** 화면에 텍스트로만 보여 줄 본문. HTML은 남기지 않는다. */
  body: string;
  attachments: SchoolNoticeAttachment[];
}

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  bull: "•",
  hellip: "…",
  ndash: "–",
  mdash: "—",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  larr: "←",
  rarr: "→",
  uarr: "↑",
  darr: "↓",
  times: "×",
};

function decodeEntities(text: string): string {
  return text.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, name: string) => {
      if (name.startsWith("#x") || name.startsWith("#X")) {
        return String.fromCodePoint(parseInt(name.slice(2), 16));
      }
      if (name.startsWith("#"))
        return String.fromCodePoint(Number(name.slice(1)));
      return entities[name.toLowerCase()] ?? match;
    },
  );
}

function cellText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 고정 공지는 표시 번호 칸이 비어 있다. 모든 페이지 맨 위에 같은 고정 공지가 반복되고 오래된
 * 안내뿐이라 뺀다. 고유 ID는 표시 번호가 아니라 제목 링크의 `readPost(<post_id>)`에서 읽는다.
 */
export function parseNoticeList(html: string): SchoolNotice[] {
  const notices: SchoolNotice[] = [];
  const rows = html.split(/<tr[^>]*class=['"]board_board['"][^>]*>/i).slice(1);

  for (const chunk of rows) {
    const row = chunk.split(/<\/tr>/i)[0];
    const cells = [...row.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(
      (match) => match[1],
    );
    const postId = Number(row.match(/readPost\((\d+)\)/)?.[1]);
    const date = cellText(cells[5] ?? "").match(/^(\d{4})\/(\d{2})\/(\d{2})$/);
    if (cells.length < 6 || !Number.isSafeInteger(postId) || !date) continue;
    if (cellText(cells[1]) === "") continue;

    notices.push({
      postId,
      category: cellText(cells[2]),
      title: cellText(cells[3]),
      author: cellText(cells[4]),
      postedOn: `${date[1]}-${date[2]}-${date[3]}`,
      hasAttachment: cells[3].includes("icon_save"),
    });
  }

  return notices;
}

type Literal = string | number | Literal[] | { [key: string]: Literal };

const ESCAPES: Record<string, string> = { n: "\n", r: "\r", t: "\t" };

/**
 * 상세 응답은 JSON이 아니라 작은따옴표 객체 리터럴이다(학교 화면은 eval로 읽는다). 실행하지 않고
 * 문자열·숫자·배열·객체만 읽으며, 그 밖의 것이 나오면 null을 돌려준다.
 */
function readLiteral(source: string): Literal | null {
  let index = 0;
  const skipSpace = () => {
    while (/\s/.test(source[index] ?? "")) index++;
  };
  const fail = () => {
    throw new SyntaxError("not a school detail literal");
  };

  const readString = (): string => {
    const quote = source[index++];
    let text = "";
    while (index < source.length) {
      const char = source[index++];
      if (char === quote) return text;
      if (char !== "\\") {
        text += char;
        continue;
      }
      const escaped = source[index++] ?? "";
      text += ESCAPES[escaped] ?? escaped;
    }
    return fail();
  };

  const readValue = (): Literal => {
    skipSpace();
    const char = source[index];
    if (char === "'" || char === '"') return readString();
    if (char === "[") {
      index++;
      const items: Literal[] = [];
      skipSpace();
      if (source[index] === "]") {
        index++;
        return items;
      }
      for (;;) {
        items.push(readValue());
        skipSpace();
        const next = source[index++];
        if (next === "]") return items;
        if (next !== ",") fail();
      }
    }
    if (char === "{") {
      index++;
      const object: { [key: string]: Literal } = {};
      skipSpace();
      if (source[index] === "}") {
        index++;
        return object;
      }
      for (;;) {
        skipSpace();
        if (source[index] !== "'" && source[index] !== '"') fail();
        const key = readString();
        skipSpace();
        if (source[index++] !== ":") fail();
        object[key] = readValue();
        skipSpace();
        const next = source[index++];
        if (next === "}") return object;
        if (next !== ",") fail();
      }
    }
    const number = /^-?\d+(\.\d+)?/.exec(source.slice(index));
    if (!number) fail();
    index += number![0].length;
    return Number(number![0]);
  };

  try {
    const value = readValue();
    skipSpace();
    return index === source.length ? value : null;
  } catch {
    return null;
  }
}

/** HTML 본문에서 글자만 남긴다. 줄을 나누는 태그는 줄바꿈으로 바꾸고 나머지 태그는 지운다. */
function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/\[\[\d+\]\]/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/?(p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]*>/g, ""),
  );
}

function normalizeBody(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * 일반 글(`use_html` 0)은 작성자가 쓴 원문 텍스트를 그대로 쓴다. HTML 글은 원문이 HTML이라 화면용
 * `content`에서 태그를 걷어 낸다. 본문 속 `[[n]]`은 학교 화면이 n번째 첨부 이미지로 바꾸는 자리라
 * 지운다. 첨부는 목록으로 따로 보여 준다.
 */
export function parseNoticeDetail(raw: string): SchoolNoticeDetail | null {
  const value = readLiteral(raw.trim());
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;

  const { use_html: useHtml, content_original: original, content } = value;
  if (typeof original !== "string" || typeof content !== "string") return null;

  const attachments: SchoolNoticeAttachment[] = [];
  for (const item of Array.isArray(value.attachment) ? value.attachment : []) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const { attachment_id: attachmentId, name, size } = item;
    if (typeof attachmentId !== "number" || typeof name !== "string") continue;
    attachments.push({
      attachmentId,
      name,
      size: typeof size === "number" ? size : 0,
    });
  }

  return {
    body: normalizeBody(useHtml === 1 ? htmlToText(content) : original),
    attachments,
  };
}
