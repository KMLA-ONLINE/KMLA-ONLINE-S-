import { describe, expect, it, vi } from "vitest";

import {
  createSyncHandler,
  type SyncReport,
} from "../../../../supabase/functions/sync-school-notices/handler";

const SECRET = "sync-secret";

function listRow(id: number, no: string) {
  return (
    `<tr class='board_board'><td><input type='checkbox' value='${id}' /></td>` +
    `<td>${no}</td><td>교무</td>` +
    `<td><div align=left><a href='javascript:readPost(${id});'>공지 ${id}</a></div></td>` +
    `<td><strong>작성자</strong></td><td>2026/10/14</td><td>1</td></tr>`
  );
}

/**
 * 세션 쿠키로 로그인 상태를 기억하는 가짜 학교 서버. 로그인하지 않은 목록 요청에는 실제 서버처럼
 * 200과 빈 표를 돌려준다. 페이지마다 같은 고정 공지 하나와 일반 공지 12개가 온다.
 */
function fakeSchool({ password = "pw", firstId = 1000 } = {}) {
  const loggedIn = new Set<string>();
  let issued = 0;

  const respond = (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const cookie = new Headers(init?.headers).get("cookie") ?? "";
    const session = /PHPSESSID=(\w+)/.exec(cookie)?.[1];

    if (url.pathname === "/members/login.php") {
      return new Response("<form></form>", {
        headers: { "set-cookie": `PHPSESSID=s${++issued}; path=/` },
      });
    }
    if (url.searchParams.get("task") === "login") {
      const form = new URLSearchParams(init?.body as string);
      if (
        session &&
        form.get("id") === "school-id" &&
        form.get("passwd") === password
      ) {
        loggedIn.add(session);
      }
      return new Response("<script>window.location='/members/';</script>");
    }
    if (url.searchParams.get("task") === "printboard") {
      let html = "<table><tr><th>번호</th></tr>";
      if (session && loggedIn.has(session)) {
        const page = Number(url.searchParams.get("page"));
        html += listRow(1, "");
        for (let i = 0; i < 12; i++) {
          const id = firstId - (page - 1) * 12 - i;
          html += listRow(id, String(id));
        }
      }
      return new Response(html + "</table>");
    }
    return new Response("not found", { status: 404 });
  };
  return vi.fn((input: string | URL | Request, init?: RequestInit) =>
    Promise.resolve(respond(input, init)),
  );
}

function setup(
  overrides: Partial<Parameters<typeof createSyncHandler>[0]> = {},
) {
  const reports: SyncReport[] = [];
  const handler = createSyncHandler({
    expectedSecret: SECRET,
    fetch: fakeSchool(),
    loadCredentials: () =>
      Promise.resolve({ loginId: "school-id", password: "pw" }),
    report: (result) => {
      reports.push(result);
      return Promise.resolve();
    },
    ...overrides,
  });
  const run = () =>
    handler(
      new Request("https://fn.test/sync-school-notices", {
        method: "POST",
        headers: { "x-sync-secret": SECRET },
      }),
    );
  return { handler, reports, run };
}

describe("sync-school-notices handler", () => {
  it("로그인한 세션으로 세 페이지를 읽어 최신 일반 공지 30건을 보고한다", async () => {
    const { reports, run } = setup();

    const response = await run();

    expect(response.status).toBe(200);
    expect(reports).toHaveLength(1);
    const ids =
      "notices" in reports[0] ? reports[0].notices.map((n) => n.postId) : [];
    expect(ids).toHaveLength(30);
    expect(ids[0]).toBe(1000);
    expect(ids[29]).toBe(971);
  });

  it("로그인이 안 돼 목록이 비면 공지 없이 실패를 보고한다", async () => {
    const { reports, run } = setup({
      fetch: fakeSchool({ password: "changed" }),
    });

    const response = await run();

    expect(response.status).toBe(502);
    expect(reports).toEqual([{ error: "empty_list" }]);
  });

  it("계정이 설정되지 않았으면 학교 서버를 부르지 않고 실패를 보고한다", async () => {
    const school = fakeSchool();
    const { reports, run } = setup({
      fetch: school,
      loadCredentials: () => Promise.resolve(null),
    });

    await run();

    expect(school).not.toHaveBeenCalled();
    expect(reports).toEqual([{ error: "missing_credentials" }]);
  });

  it("학교 서버에 닿지 못하면 자격증명 없는 오류 코드만 보고한다", async () => {
    const { reports, run } = setup({
      fetch: vi.fn(() =>
        Promise.reject(new TypeError("connect failed for school-id:pw")),
      ),
    });

    await run();

    expect(reports).toEqual([{ error: "school_unreachable" }]);
  });

  it("시크릿이 맞지 않으면 아무것도 하지 않고 401을 준다", async () => {
    const school = fakeSchool();
    const { handler, reports } = setup({ fetch: school });

    const response = await handler(
      new Request("https://fn.test/sync-school-notices", {
        method: "POST",
        headers: { "x-sync-secret": "wrong" },
      }),
    );

    expect(response.status).toBe(401);
    expect(school).not.toHaveBeenCalled();
    expect(reports).toEqual([]);
  });
});
