import { describe, expect, it } from "vitest";

// Release scripts run directly under Node as MJS.
// @ts-expect-error The module is intentionally an untyped MJS module.
import * as plan from "../../../scripts/release/plan.mjs";

interface Pr {
  number: number;
  title: string;
  url: string;
  body: string | null;
  files: string[];
  onMain?: boolean;
}

interface Commit {
  sha: string;
  message: string;
  url: string;
  onMain?: boolean;
}

interface Changes {
  prs: Pr[];
  commits: Commit[];
}

const {
  impacts,
  releaseSection,
  followUps,
  nextVersion,
  canRelease,
  releaseState,
  previousRelease,
  followUpTitle,
  formatReleaseComment,
  formatDashboard,
  formatReleasePr,
  formatReleaseNotes,
  formatFollowUpIssue,
  noticeInput,
  isNothingToAnnounce,
  noticeFrom,
  noticeModels,
  noticeRetry,
} = plan as {
  impacts: (files: string[]) => string[];
  releaseSection: (body: string | null) => {
    tasks: string[];
    skipped: string[];
  };
  followUps: (changes: Changes) => {
    tasks: { pr: number; text: string }[];
    skipped: { pr: number; count: number }[];
  };
  nextVersion: (now: Date, tags: string[]) => string;
  canRelease: (permission: string) => boolean;
  releaseState: (
    run: { status: string; conclusion: string | null; html_url: string } | null,
  ) => { state: string; url: string | null };
  previousRelease: (
    releases: { tag_name: string; draft: boolean; prerelease: boolean }[],
    exclude: string,
  ) => string | null;
  followUpTitle: (version: string) => string;
  formatReleaseComment: (result: object) => string;
  formatDashboard: (input: object) => string;
  formatReleasePr: (input: object) => string;
  formatReleaseNotes: (input: object) => string;
  formatFollowUpIssue: (input: object) => string | null;
  noticeInput: (changes: Changes) => string;
  isNothingToAnnounce: (text: string) => boolean;
  noticeFrom: (
    output: { status?: string; text?: string; base?: string },
    expected: { base: string | null; logUrl: string | null },
  ) => { status: string; text?: string; logUrl?: string | null };
  noticeModels: (value: string) => string[];
  noticeRetry: (response: {
    status: number;
    body: string;
    attempt: number;
  }) => { retry: number } | { next: true } | { fail: true };
};

function pr(number: number, overrides: Partial<Pr> = {}): Pr {
  return {
    number,
    title: `Change ${number}`,
    url: `https://github.com/o/r/pull/${number}`,
    body: null,
    files: ["app/routes/home.tsx"],
    ...overrides,
  };
}

const TEMPLATE_BODY = `## 왜

이유

## 릴리즈

<!-- 템플릿 안내. - 공지: 무시되어야 함 -->

- 공지: 홈 피드에서 연 글이 읽음으로 표시됩니다.
- 할 일: prod Vault에 \`storage_cleanup_secret\`을 넣는다.
- 공개 범위 설정을 Dashboard에서 확인

## 검증

- 공지: 다른 절이므로 무시
`;

describe("impacts", () => {
  it("names each deployment impact once, in a fixed order", () => {
    expect(
      impacts([
        "supabase/config.toml",
        "supabase/.env.example",
        ".env.example",
        "supabase/functions/dispatch-notifications/index.ts",
        "supabase/schemas/31-posts.sql",
        "supabase/migrations/20261103000000_third.sql",
      ]),
    ).toEqual([
      "DB",
      "Edge Function",
      "`VITE_*` 변수",
      "Function 시크릿",
      "`config.toml`",
    ]);
  });

  it("ignores files that are not deployed or configured per project", () => {
    expect(
      impacts([
        "app/routes/home.tsx",
        "supabase/seed.sql",
        "supabase/tests/posts.test.sql",
      ]),
    ).toEqual([]);
  });
});

describe("releaseSection", () => {
  // 공지는 PR에서 모으지 않고 릴리즈 후 생성하므로, 남아 있는 `공지:` 줄은 읽지 않는다.
  it("reads tasks from the 릴리즈 section only and ignores 공지 lines", () => {
    expect(releaseSection(TEMPLATE_BODY)).toEqual({
      tasks: [
        "prod Vault에 `storage_cleanup_secret`을 넣는다.",
        "공개 범위 설정을 Dashboard에서 확인",
      ],
      skipped: [],
    });
  });

  it("returns nothing for a body without the section", () => {
    const empty = { tasks: [], skipped: [] };
    expect(releaseSection(null)).toEqual(empty);
    expect(releaseSection("## 왜\n\n- 공지: 아님\n")).toEqual(empty);
  });

  it("ignores an untouched template section", () => {
    expect(
      releaseSection("## 릴리즈\n\n<!--\n- 공지: 예시\n- 할 일: 예시\n-->\n"),
    ).toEqual({ tasks: [], skipped: [] });
  });

  it("accepts the 릴리스 spelling", () => {
    expect(releaseSection("## 릴리스\n\n- 할 일: 철자\n").tasks).toEqual([
      "철자",
    ]);
  });

  it("drops task-list checkboxes before reading the prefix", () => {
    expect(
      releaseSection("## 릴리즈\n\n- [ ] 할 일: 시크릿\n- [x] 공지: 완료\n"),
    ).toEqual({ tasks: ["시크릿"], skipped: [] });
  });

  it("joins indented continuation lines to their item", () => {
    expect(
      releaseSection(
        "## 릴리즈\n\n- 할 일: prod Vault에\n  `storage_cleanup_secret`을 넣는다.\n  - 공지: 하위 항목\n",
      ),
    ).toEqual({
      tasks: ["prod Vault에 `storage_cleanup_secret`을 넣는다."],
      skipped: [],
    });
  });

  it("ignores code blocks, including headings inside them", () => {
    const body = [
      "## 릴리즈",
      "",
      "```bash",
      "- 공지: 코드",
      "## 아님",
      "```",
      "",
      "- 할 일: 코드 뒤",
      "",
      "## 검증",
    ].join("\n");
    expect(releaseSection(body)).toEqual({
      tasks: ["코드 뒤"],
      skipped: [],
    });
  });

  it("closes a code block on a longer fence, as CommonMark does", () => {
    const body = [
      "```",
      "code",
      "````",
      "",
      "## 릴리즈",
      "",
      "- 할 일: 코드 블록 뒤",
    ].join("\n");
    expect(releaseSection(body).tasks).toEqual(["코드 블록 뒤"]);
  });

  it("reports lines it could not read instead of dropping them silently", () => {
    expect(
      releaseSection(
        "## 릴리즈\n\n공지할 것 있음\n1. 할 일: 번호 목록\n- 할 일: 읽힘\n",
      ),
    ).toEqual({
      tasks: ["번호 목록", "읽힘"],
      skipped: ["공지할 것 있음"],
    });
  });
});

describe("followUps", () => {
  it("adds checks implied by changed files to the author's tasks", () => {
    const result = followUps({
      prs: [
        pr(1, { body: TEMPLATE_BODY }),
        pr(2, { files: [".env.example", "supabase/.env.example"] }),
        pr(3, { files: ["supabase/config.toml"] }),
      ],
      commits: [],
    });

    expect(result.tasks.map((task) => task.pr)).toEqual([1, 1, 2, 2, 3]);
    expect(result.tasks[2].text).toContain("Vercel Production");
    expect(result.tasks[3].text).toContain("Edge Function 시크릿");
    expect(result.tasks[4].text).toContain("config push");
    expect(result.skipped).toEqual([]);
  });

  it("counts unread lines per PR", () => {
    const result = followUps({
      prs: [pr(7, { body: "## 릴리즈\n\n문장 하나\n문장 둘\n" })],
      commits: [],
    });
    expect(result.skipped).toEqual([{ pr: 7, count: 2 }]);
  });
});

describe("noticeInput", () => {
  it("gives the model each change's title and user-facing sections only", () => {
    const input = noticeInput({
      prs: [
        pr(418, {
          title: "Record posts read",
          body: [
            "## 왜",
            "",
            "<!-- 안내 -->",
            "홈에서 연 글이 읽음으로 남지 않았다.",
            "",
            "## 바뀌는 동작",
            "",
            "| 전 | 후 |",
            "| --- | --- |",
            "| 안 읽음 | 읽음 |",
            "",
            "```sql",
            "select 1;",
            "```",
            "",
            "## 리뷰 포인트",
            "",
            "- `app/x.ts:1` 내부 구현",
            "",
            "## 검증",
            "",
            "- npm test",
          ].join("\n"),
        }),
        pr(420, { title: "Bump deps", body: null }),
      ],
      commits: [
        {
          sha: "abcdef1234567",
          message: "Fix typo\n\nIn the footer",
          url: "https://c",
        },
      ],
    });

    expect(input).toBe(
      [
        "## #418 Record posts read",
        "",
        "### 왜",
        "",
        "홈에서 연 글이 읽음으로 남지 않았다.",
        "",
        "### 바뀌는 동작",
        "",
        "| 전 | 후 |",
        "| --- | --- |",
        "| 안 읽음 | 읽음 |",
        "",
        "## #420 Bump deps",
        "",
        "## 커밋 abcdef1 Fix typo",
        "",
        "In the footer",
        "",
      ].join("\n"),
    );
  });
});

describe("noticeInput headings", () => {
  it("nests a PR's own subheadings below its sections", () => {
    const input = noticeInput({
      prs: [
        pr(5, {
          title: "Split",
          body: "## 바뀌는 동작\n\n### 메시지\n\n- 늘림\n\n#### 세부\n\n- 값\n",
        }),
      ],
      commits: [],
    });
    expect(input).toContain(
      "### 바뀌는 동작\n\n##### 메시지\n\n- 늘림\n\n###### 세부",
    );
    expect(input.match(/^## /gm)).toHaveLength(1);
  });
});

describe("isNothingToAnnounce", () => {
  it("reads the model's 'nothing to announce' reply in common wrappings", () => {
    for (const reply of [
      "없음",
      "**없음**",
      "‘없음’",
      "없음.",
      "없음입니다.",
      "- 없음",
      "  없음\n",
    ]) {
      expect(isNothingToAnnounce(reply), reply).toBe(true);
    }
  });

  it("keeps a draft that only mentions the word", () => {
    expect(isNothingToAnnounce("메시지\n- 없음 표시를 고쳤습니다.")).toBe(
      false,
    );
    expect(
      isNothingToAnnounce("‘없음’ 표시가 사라지던 문제를 수정했습니다."),
    ).toBe(false);
  });
});

describe("noticeModels", () => {
  it("reads a comma-separated fallback list in order", () => {
    expect(noticeModels(" gemini-a, gemini-b,,")).toEqual([
      "gemini-a",
      "gemini-b",
    ]);
    expect(noticeModels("gemini-a")).toEqual(["gemini-a"]);
  });
});

describe("noticeRetry", () => {
  it("backs off on a transient server error, then moves to the next model", () => {
    const overloaded = { status: 503, body: "" };
    expect(noticeRetry({ ...overloaded, attempt: 1 })).toEqual({ retry: 15 });
    expect(noticeRetry({ ...overloaded, attempt: 2 })).toEqual({ retry: 30 });
    expect(noticeRetry({ ...overloaded, attempt: 3 })).toEqual({ next: true });
  });

  it("waits out a per-minute quota but moves on from an exhausted one", () => {
    const quota = (retryDelay?: string) =>
      JSON.stringify({
        error: {
          code: 429,
          details: [
            { "@type": "type.googleapis.com/google.rpc.QuotaFailure" },
            ...(retryDelay
              ? [
                  {
                    "@type": "type.googleapis.com/google.rpc.RetryInfo",
                    retryDelay,
                  },
                ]
              : []),
          ],
        },
      });
    expect(
      noticeRetry({ status: 429, body: quota("11.5s"), attempt: 1 }),
    ).toEqual({ retry: 12 });
    expect(
      noticeRetry({ status: 429, body: quota("11.5s"), attempt: 3 }),
    ).toEqual({ next: true });
    expect(
      noticeRetry({ status: 429, body: quota("3600s"), attempt: 1 }),
    ).toEqual({ next: true });
    expect(noticeRetry({ status: 429, body: quota(), attempt: 1 })).toEqual({
      next: true,
    });
    expect(noticeRetry({ status: 429, body: "not json", attempt: 1 })).toEqual({
      next: true,
    });
  });

  it("moves past a retired model but stops on a request or key error", () => {
    expect(noticeRetry({ status: 404, body: "", attempt: 1 })).toEqual({
      next: true,
    });
    for (const status of [400, 401, 403]) {
      expect(
        noticeRetry({ status, body: "", attempt: 1 }),
        `${status}`,
      ).toEqual({ fail: true });
    }
  });
});

describe("noticeFrom", () => {
  const expected = { base: "v2026.11.10", logUrl: "https://x/runs/5" };

  it("uses the draft when it covers the same range as the release", () => {
    expect(
      noticeFrom(
        { status: "ok", text: "피드\n- 바뀜", base: "v2026.11.10" },
        expected,
      ),
    ).toEqual({ status: "ok", text: "피드\n- 바뀜" });
    expect(
      noticeFrom({ status: "none", base: "v2026.11.10" }, expected),
    ).toEqual({
      status: "none",
    });
  });

  // 앞 릴리즈의 태그가 생기기 전에 초안을 만들면 앞 릴리즈 변경까지 들어간다.
  it("asks for a hand-written notice when the draft compared another range", () => {
    expect(
      noticeFrom(
        { status: "ok", text: "피드\n- 바뀜", base: "v2026.11.9" },
        expected,
      ),
    ).toEqual({ status: "failed", logUrl: "https://x/runs/5" });
    expect(
      noticeFrom({ status: "none", base: "v2026.11.9" }, expected),
    ).toEqual({
      status: "failed",
      logUrl: "https://x/runs/5",
    });
  });

  it("treats a missing or failed draft as failed", () => {
    for (const output of [
      {},
      { status: "failed", base: "v2026.11.10" },
      { status: "ok", base: "v2026.11.10" },
    ]) {
      expect(noticeFrom(output, expected)).toEqual({
        status: "failed",
        logUrl: "https://x/runs/5",
      });
    }
  });
});

describe("nextVersion", () => {
  // 2026-11-10 08:30 KST is still 2026-11-09 in UTC.
  const morning = new Date("2026-11-09T23:30:00Z");

  it("uses the Korean calendar date without zero padding", () => {
    expect(nextVersion(new Date("2026-11-04T03:00:00Z"), [])).toBe(
      "v2026.11.4",
    );
    expect(nextVersion(morning, ["v2026.11.9"])).toBe("v2026.11.10");
  });

  it("numbers further releases on the same day from 2", () => {
    expect(nextVersion(morning, ["v2026.11.10"])).toBe("v2026.11.10.2");
    expect(
      nextVersion(morning, ["v2026.11.10.3", "v2026.11.10", "v2026.11.1"]),
    ).toBe("v2026.11.10.4");
  });
});

describe("canRelease", () => {
  it("allows repository admins only", () => {
    expect(canRelease("admin")).toBe(true);
    // The permission API reports maintain as write.
    for (const permission of ["write", "triage", "read", "none"]) {
      expect(canRelease(permission)).toBe(false);
    }
  });
});

describe("releaseState", () => {
  const run = (status: string, conclusion: string | null) => ({
    status,
    conclusion,
    html_url: "https://x/runs/9",
  });

  it("tells a running release from a failed or done one", () => {
    // No approval gate: a release that has not finished is still deploying.
    expect(releaseState(run("waiting", null))).toEqual({
      state: "running",
      url: "https://x/runs/9",
    });
    expect(releaseState(run("queued", null)).state).toBe("running");
    expect(releaseState(run("in_progress", null)).state).toBe("running");
    expect(releaseState(run("completed", "failure")).state).toBe("failed");
    expect(releaseState(run("completed", "cancelled")).state).toBe("failed");
    expect(releaseState(run("completed", "success")).state).toBe("deployed");
    expect(releaseState(null)).toEqual({ state: "unknown", url: null });
  });
});

describe("previousRelease", () => {
  it("skips drafts, prereleases, and the release being published", () => {
    expect(
      previousRelease(
        [
          { tag_name: "v2026.11.12", draft: false, prerelease: false },
          { tag_name: "v2026.11.11", draft: true, prerelease: false },
          { tag_name: "v2026.11.10.2", draft: false, prerelease: true },
          { tag_name: "v2026.11.10", draft: false, prerelease: false },
        ],
        "v2026.11.12",
      ),
    ).toBe("v2026.11.10");
    expect(previousRelease([], "v2026.11.12")).toBeNull();
  });
});

describe("followUpTitle", () => {
  it("names the checklist after the version", () => {
    expect(followUpTitle("v2026.11.12")).toBe("v2026.11.12 릴리즈 후 할 일");
  });
});

describe("formatReleaseComment", () => {
  const head = { sha: "aaaaaaa1111111", url: "https://c/a" };

  it("warns when dev moved while the release PR was opened", () => {
    const comment = formatReleaseComment({
      kind: "opened",
      number: 430,
      head,
      actualSha: "bbbbbbb2222222",
    });
    expect(comment).toContain("릴리즈 PR을 만들었습니다: #430");
    expect(comment).toContain("`bbbbbbb`");
    expect(comment).toContain("배포");

    const steady = formatReleaseComment({
      kind: "opened",
      number: 430,
      head,
      actualSha: head.sha,
    });
    expect(steady).toContain("릴리즈 PR을 만들었습니다: #430");
    expect(steady).not.toContain("`bbbbbbb`");
  });

  it("points to an open release PR instead of rewriting it", () => {
    const ready = formatReleaseComment({
      kind: "already-open",
      number: 426,
      head,
      deploy: { conclusion: "success", url: "https://x/runs/4" },
    });
    expect(ready).toContain("릴리즈 PR #426이 이미 열려 있습니다");
    expect(ready).toContain("자동으로 갱신");
    expect(ready).toContain("`aaaaaaa`의 배포: [성공](https://x/runs/4)");
    expect(ready).not.toContain("merge 전에");

    const failing = formatReleaseComment({
      kind: "already-open",
      number: 426,
      head,
      deploy: { conclusion: "failure", url: "https://x/runs/5" },
    });
    expect(failing).toContain("[실패](https://x/runs/5)");
    expect(failing).toContain("merge 전에");
  });

  it("does not call a release still deploying a failure", () => {
    const running = formatReleaseComment({
      kind: "stranded",
      count: 2,
      release: { state: "running", url: "https://x/runs/9" },
    });
    expect(running).toContain("진행 중");
    expect(running).not.toContain("다시 실행");

    const failed = formatReleaseComment({
      kind: "stranded",
      count: 2,
      release: { state: "failed", url: "https://x/runs/9" },
    });
    expect(failed).toContain("다시 실행");
  });

  it("explains a dev head that has not deployed yet", () => {
    expect(
      formatReleaseComment({
        kind: "not-deployed",
        head,
        deploy: { conclusion: null, url: "https://x/runs/3" },
      }),
    ).toContain("`aaaaaaa`의 배포가 아직 성공하지 않아");
  });
});

describe("formatters", () => {
  const changes: Changes = {
    prs: [
      pr(418, {
        title: "Record posts | read",
        files: ["supabase/migrations/20261103000000_read.sql"],
        body: TEMPLATE_BODY,
      }),
      pr(420),
    ],
    commits: [
      {
        sha: "abcdef1234567",
        message: "Fix typo\n\nbody",
        url: "https://github.com/o/r/commit/abcdef1",
      },
    ],
  };
  const head = {
    sha: "0609b91aaaaaaa",
    url: "https://github.com/o/r/commit/0609b91",
  };
  const deploy = {
    conclusion: "success",
    url: "https://github.com/o/r/actions/runs/1",
  };

  it("lists pending changes, the dev deployment, and how to release", () => {
    const body = formatDashboard({
      changes,
      head,
      deploy,
      releasePr: null,
    });

    expect(body.startsWith("<!-- release-dashboard -->")).toBe(true);
    expect(body).toContain("`0609b91`");
    expect(body).toContain("[성공](https://github.com/o/r/actions/runs/1)");
    expect(body).toContain("[dev.kmla.online](https://dev.kmla.online)");
    expect(body).toContain("`/release`");
    expect(body).toContain("| #418 | Record posts \\| read | DB |");
    expect(body).toContain(
      "- [`abcdef1`](https://github.com/o/r/commit/abcdef1) Fix typo",
    );
    expect(body).not.toContain("홈 피드에서 연 글이 읽음으로 표시됩니다.");
    expect(body).not.toContain("### 공지");
    expect(body).not.toContain("- [ ]");
  });

  it("says when nothing is waiting", () => {
    const body = formatDashboard({
      changes: { prs: [], commits: [] },
      head,
      deploy,
      releasePr: null,
    });
    expect(body).toContain("릴리즈할 변경이 없습니다");
    expect(body).toContain("[dev.kmla.online](https://dev.kmla.online)");
  });

  it("marks a release PR body so later updates can find it", () => {
    const body = formatReleasePr({ changes, head, deploy });
    expect(body.startsWith("<!-- release-pr -->")).toBe(true);
    expect(body).toContain("## 바뀌는 동작");
    expect(body).toContain("## DB·배포");
    expect(body).toContain("prod에 배포");
  });

  it("shows a failed dev deployment", () => {
    const body = formatReleasePr({
      changes,
      head,
      deploy: { conclusion: "failure", url: "https://x/runs/2" },
    });
    expect(body).toContain("[실패](https://x/runs/2)");
  });

  it("writes release notes from the PR list", () => {
    const notes = formatReleaseNotes({ changes });
    expect(notes).toContain("- Record posts | read (#418)");
    expect(notes).toContain("- Fix typo (`abcdef1`)");
  });

  it("writes a follow-up checklist, or nothing when there is none", () => {
    const issue = formatFollowUpIssue({
      version: "v2026.11.10",
      releaseUrl: "https://github.com/o/r/releases/tag/v2026.11.10",
      changes,
    });
    expect(issue).toContain("v2026.11.10");
    expect(issue).not.toContain("홈 피드에서 연 글이 읽음으로 표시됩니다.");
    expect(issue).toContain("- [ ] #418: prod Vault에");

    expect(
      formatFollowUpIssue({
        version: "v2026.11.10",
        releaseUrl: "https://x",
        changes: { prs: [pr(1)], commits: [] },
      }),
    ).toBeNull();
  });

  describe("notice draft in the follow-up checklist", () => {
    const quiet: Changes = { prs: [pr(1)], commits: [] };
    const base = { version: "v2026.11.10", releaseUrl: "https://x" };

    it("opens the checklist with the generated draft as raw markdown", () => {
      const issue = formatFollowUpIssue({
        ...base,
        changes: quiet,
        notice: { status: "ok", text: "메시지\n- **글자 수를 늘렸습니다.**\n" },
      });
      expect(issue).toContain("### 공지 초안");
      expect(issue).toContain("- [ ] 아래 초안을 다듬어 공지합니다.");
      expect(issue).toContain(
        "```markdown\n메시지\n- **글자 수를 늘렸습니다.**\n```",
      );
    });

    it("puts the draft before the tasks", () => {
      const issue = formatFollowUpIssue({
        ...base,
        changes,
        notice: { status: "ok", text: "피드\n- 바뀜" },
      })!;
      expect(issue.indexOf("### 공지 초안")).toBeGreaterThan(-1);
      expect(issue.indexOf("### 공지 초안")).toBeLessThan(
        issue.indexOf("### 할 일"),
      );
    });

    it("fences a draft that itself contains a code fence", () => {
      const issue = formatFollowUpIssue({
        ...base,
        changes: quiet,
        notice: { status: "ok", text: "```\ncode\n```" },
      });
      expect(issue).toContain("````markdown\n```\ncode\n```\n````");
    });

    it("says there is nothing to announce, and opens nothing without tasks", () => {
      expect(
        formatFollowUpIssue({
          ...base,
          changes: quiet,
          notice: { status: "none" },
        }),
      ).toBeNull();
      const issue = formatFollowUpIssue({
        ...base,
        changes,
        notice: { status: "none" },
      });
      expect(issue).toContain("공지할 변화가 없습니다.");
      expect(issue).not.toContain("```markdown");
    });

    it("leaves a task to write the notice by hand when generation failed", () => {
      const issue = formatFollowUpIssue({
        ...base,
        changes: quiet,
        notice: { status: "failed", logUrl: "https://x/runs/5" },
      });
      expect(issue).toContain("- [ ] 공지 초안을 만들지 못했습니다.");
      expect(issue).toContain("[실행 기록](https://x/runs/5)");
    });
  });

  const unread: Changes = {
    prs: [pr(9, { body: "## 릴리즈\n\n목록이 아닌 문장\n" })],
    commits: [],
  };

  it("flags PRs whose release section has unread lines", () => {
    for (const body of [
      formatDashboard({ changes: unread, head, deploy, releasePr: null }),
      formatReleasePr({ changes: unread, head, deploy }),
    ]) {
      expect(body).toContain("[#9](https://github.com/o/r/pull/9)");
      expect(body).toContain("읽지 못한 줄 1개");
    }
    expect(
      formatFollowUpIssue({
        version: "v2026.11.10",
        releaseUrl: "https://x",
        changes: unread,
      }),
    ).toContain("- [ ] #9: `## 릴리즈` 절에서 읽지 못한 줄 1개");
  });

  const lastRelease = {
    tag: "v2026.11.10",
    url: "https://github.com/o/r/releases/tag/v2026.11.10",
  };
  const stranded: Changes = {
    prs: [
      pr(500, { title: "Merged, never deployed", onMain: true }),
      pr(501, { title: "Only on dev" }),
    ],
    commits: [],
  };

  it("separates merged but undeployed changes from dev-only ones", () => {
    const body = formatDashboard({
      changes: stranded,
      head,
      deploy,
      releasePr: null,
      lastRelease,
    });

    expect(body).toContain(
      "[v2026.11.10](https://github.com/o/r/releases/tag/v2026.11.10)",
    );
    const waiting = body.indexOf("## prod 배포 대기 (1)");
    const pending = body.indexOf("## 릴리즈 대기 (1)");
    expect(waiting).toBeGreaterThan(-1);
    expect(pending).toBeGreaterThan(waiting);
    expect(body.indexOf("#500")).toBeGreaterThan(waiting);
    expect(body.indexOf("#500")).toBeLessThan(pending);
    expect(body.indexOf("#501")).toBeGreaterThan(pending);
    expect(body).toContain("`/release`");
  });

  it("words the stranded section by the state of the main release run", () => {
    const running = formatDashboard({
      changes: stranded,
      head,
      deploy,
      releasePr: null,
      lastRelease,
      release: { state: "running", url: "https://x/runs/9" },
    });
    expect(running).toContain("prod 배포가 진행 중입니다");
    expect(running).not.toContain("실패");

    const failed = formatDashboard({
      changes: stranded,
      head,
      deploy,
      releasePr: null,
      lastRelease,
      release: { state: "failed", url: "https://x/runs/9" },
    });
    expect(failed).toContain("prod 배포가 실패해");
    expect(failed).not.toContain("거부");
    expect(failed).toContain("https://x/runs/9");
  });

  it("says merging the release PR deploys prod, with no approval step", () => {
    const body = formatReleasePr({ changes, head, deploy });
    expect(body).toContain("merge하면");
    expect(body).toContain("곧바로 prod에 배포");
    expect(body).not.toContain("승인");
    const opened = formatReleaseComment({
      kind: "opened",
      number: 430,
      head,
      actualSha: head.sha,
    });
    expect(opened).not.toContain("승인");
  });

  it("disarms closing keywords so merging to main closes nothing", () => {
    const keywords: Changes = {
      prs: [
        pr(12, {
          title: "Fixes #350 crash on login",
          body: "## 릴리즈\n\n- 할 일: close #312 after checking, resolves o/r#7\n",
        }),
      ],
      commits: [],
    };
    const body = formatReleasePr({ changes: keywords, head, deploy });
    expect(body).not.toMatch(/\b(fixes|close|resolves)\s+(o\/r)?#\d+/i);
    expect(body).toContain("#350");
    expect(body).toContain("#312");
  });

  it("shows only undeployed changes when dev has nothing new", () => {
    const body = formatDashboard({
      changes: { prs: [pr(500, { onMain: true })], commits: [] },
      head,
      deploy,
      releasePr: null,
      lastRelease,
    });
    expect(body).toContain("## prod 배포 대기 (1)");
    expect(body).not.toContain("## 릴리즈 대기");
    expect(body).not.toContain("`/release`");
  });

  it("says there is no release yet before the first tag", () => {
    const body = formatDashboard({
      changes,
      head,
      deploy,
      releasePr: null,
      lastRelease: null,
    });
    // Last release, then release PR.
    expect(body).toContain("| 없음 | 없음 |");
  });

  it("lists undeployed changes that ship with the release PR", () => {
    const body = formatReleasePr({ changes: stranded, head, deploy });
    const shipped = body.indexOf("함께 나갑니다");
    expect(body.indexOf("#501")).toBeLessThan(shipped);
    expect(body.indexOf("#500")).toBeGreaterThan(shipped);
  });

  it("copies mentions without notifying anyone, except inside code", () => {
    const mentions: Changes = {
      prs: [
        pr(11, {
          title: "Ping @alice",
          body: "## 릴리즈\n\n- 할 일: @bob 확인, `@types/node` 갱신\n",
        }),
      ],
      commits: [
        { sha: "1234567890", message: "Thanks @carol", url: "https://c" },
      ],
    };
    const outputs = [
      formatDashboard({ changes: mentions, head, deploy, releasePr: null }),
      formatReleasePr({ changes: mentions, head, deploy }),
      formatReleaseNotes({ changes: mentions }),
      formatFollowUpIssue({
        version: "v2026.11.10",
        releaseUrl: "https://x",
        changes: mentions,
      }) ?? "",
    ];
    for (const output of outputs) {
      expect(output).not.toMatch(/@(alice|bob|carol)/);
    }
    expect(outputs[0]).toContain("@\u200balice");
    expect(outputs[3]).toContain("@\u200bbob 확인, `@types/node` 갱신");
  });
});
