import {
  parseNoticeDetail,
  parseNoticeList,
  type SchoolNotice,
  type SchoolNoticeDetail,
} from "./school-board.ts";

export const SCHOOL_ORIGIN = "https://old.minjok.hs.kr";
/** 보관할 최신 일반 공지 수. 학교 목록은 한 페이지에 일반 공지 12건이라 세 페이지를 읽는다. */
export const NOTICE_LIMIT = 30;
const PAGES = 3;
const REQUEST_TIMEOUT_MS = 15_000;
/** 학교 서버에 한꺼번에 보내는 상세 요청 수. 낡은 서버라 몇 개씩만 나눠 보낸다. */
const DETAIL_CONCURRENCY = 3;

export interface SchoolCredentials {
  loginId: string;
  password: string;
}

export type SyncedNotice = SchoolNotice & SchoolNoticeDetail;

export type SyncReport = { notices: SyncedNotice[] } | { error: string };

export interface SyncDependencies {
  expectedSecret: string;
  fetch: typeof fetch;
  loadCredentials: () => Promise<SchoolCredentials | null>;
  report: (result: SyncReport) => Promise<void>;
}

const listUrl = (page: number) =>
  `${SCHOOL_ORIGIN}/lens/main.php?module=board&task=printboard&board_id=22&page=${page}&kwd=&sfl=title`;
const detailUrl = (postId: number) =>
  `${SCHOOL_ORIGIN}/lens/main.php?module=board&board_id=22&task=read&post_id=${postId}`;

/**
 * 학교 세션은 PHPSESSID 쿠키 하나다. 로그인 페이지에서 받은 세션에 로그인을 묶고 같은 쿠키로
 * 목록을 읽는다. 세션은 이 실행 안에서만 쓰고 어디에도 남기지 않는다.
 */
function createSession(fetchImpl: typeof fetch) {
  const cookies = new Map<string, string>();

  return async (url: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (cookies.size > 0) {
      headers.set(
        "cookie",
        [...cookies].map(([name, value]) => `${name}=${value}`).join("; "),
      );
    }
    const response = await fetchImpl(url, {
      ...init,
      headers,
      redirect: "manual",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    for (const header of response.headers.getSetCookie()) {
      const [pair] = header.split(";");
      const index = pair.indexOf("=");
      if (index > 0)
        cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }
    if (response.status >= 400)
      throw new Error(`school_http_${response.status}`);
    return response.text();
  };
}

async function collectNotices(
  fetchImpl: typeof fetch,
  credentials: SchoolCredentials,
): Promise<SyncedNotice[]> {
  const request = createSession(fetchImpl);
  await request(`${SCHOOL_ORIGIN}/members/login.php`);
  await request(
    `${SCHOOL_ORIGIN}/lens/main.php?module=member&task=login&callback=members`,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        id: credentials.loginId,
        passwd: credentials.password,
      }).toString(),
    },
  );

  // 읽는 사이 새 글이 올라오면 다음 페이지 첫 줄이 앞 페이지 끝과 겹친다. ID로 한 번만 남긴다.
  const byId = new Map<number, SchoolNotice>();
  for (let page = 1; page <= PAGES && byId.size < NOTICE_LIMIT; page++) {
    const notices = parseNoticeList(await request(listUrl(page)));
    // 게시판은 세 페이지보다 훨씬 길어서 빈 페이지는 도중에 세션이 풀렸다는 뜻이다. 일부만 모은
    // 목록으로 저장된 목록을 덮지 않도록 전체를 실패로 돌린다.
    if (notices.length === 0) return [];
    for (const notice of notices) {
      if (!byId.has(notice.postId)) byId.set(notice.postId, notice);
    }
  }
  const latest = [...byId.values()].slice(0, NOTICE_LIMIT);

  // 상세도 로그인이 풀리면 200과 로그인 화면 스크립트가 온다. 한 건이라도 못 읽으면 전체를 실패로
  // 돌려 본문 없는 공지로 저장된 목록을 덮지 않는다.
  const synced: SyncedNotice[] = [];
  for (let start = 0; start < latest.length; start += DETAIL_CONCURRENCY) {
    const batch = latest.slice(start, start + DETAIL_CONCURRENCY);
    const details = await Promise.all(
      batch.map(async (notice) =>
        parseNoticeDetail(await request(detailUrl(notice.postId))),
      ),
    );
    details.forEach((detail, index) => {
      if (!detail) throw new Error("detail_unreadable");
      synced.push({ ...batch[index], ...detail });
    });
  }
  return synced;
}

/**
 * 학교는 로그인이 풀려도 목록 요청에 200과 빈 표를 준다. 로그인 실패와 만료를 응답 코드로 알 수
 * 없으므로, 읽은 페이지 중 하나라도 비면 실패로 보고해 저장된 목록을 빈 목록이나 일부 목록으로
 * 덮지 않게 한다.
 * 오류 문자열에는 자격증명이나 쿠키를 넣지 않는다.
 */
export function createSyncHandler(deps: SyncDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    if (
      !deps.expectedSecret ||
      request.headers.get("x-sync-secret") !== deps.expectedSecret
    ) {
      return new Response("Unauthorized", { status: 401 });
    }

    let result: SyncReport;
    try {
      const credentials = await deps.loadCredentials();
      if (!credentials) {
        result = { error: "missing_credentials" };
      } else {
        const notices = await collectNotices(deps.fetch, credentials);
        result = notices.length > 0 ? { notices } : { error: "empty_list" };
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      const message = error instanceof Error ? error.message : "";
      result = {
        error:
          message.startsWith("school_http_") || message === "detail_unreadable"
            ? message
            : name === "TimeoutError"
              ? "school_timeout"
              : "school_unreachable",
      };
    }

    try {
      await deps.report(result);
    } catch {
      return Response.json({ error: "report_failed" }, { status: 500 });
    }
    return "error" in result
      ? Response.json({ error: result.error }, { status: 502 })
      : Response.json({ stored: result.notices.length });
  };
}
