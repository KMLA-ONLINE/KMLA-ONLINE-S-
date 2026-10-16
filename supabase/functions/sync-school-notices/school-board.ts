// 학교 인트라넷 공지 게시판(board_id=22)의 목록 HTML을 읽는다. Deno 전용 API를 쓰지 않아 Vitest가
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

const entities: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
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
