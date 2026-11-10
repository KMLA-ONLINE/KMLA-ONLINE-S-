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
  formatDashboard,
  formatReleasePr,
  formatReleaseNotes,
  formatFollowUpIssue,
} = plan as {
  impacts: (files: string[]) => string[];
  releaseSection: (body: string | null) => {
    notices: string[];
    tasks: string[];
    skipped: string[];
  };
  followUps: (changes: Changes) => {
    notices: { pr: number; text: string }[];
    tasks: { pr: number; text: string }[];
    skipped: { pr: number; count: number }[];
  };
  nextVersion: (now: Date, tags: string[]) => string;
  canRelease: (permission: string) => boolean;
  formatDashboard: (input: object) => string;
  formatReleasePr: (input: object) => string;
  formatReleaseNotes: (input: object) => string;
  formatFollowUpIssue: (input: object) => string | null;
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
  it("reads notices and tasks from the 릴리즈 section only", () => {
    expect(releaseSection(TEMPLATE_BODY)).toEqual({
      notices: ["홈 피드에서 연 글이 읽음으로 표시됩니다."],
      tasks: [
        "prod Vault에 `storage_cleanup_secret`을 넣는다.",
        "공개 범위 설정을 Dashboard에서 확인",
      ],
      skipped: [],
    });
  });

  it("returns nothing for a body without the section", () => {
    const empty = { notices: [], tasks: [], skipped: [] };
    expect(releaseSection(null)).toEqual(empty);
    expect(releaseSection("## 왜\n\n- 공지: 아님\n")).toEqual(empty);
  });

  it("ignores an untouched template section", () => {
    expect(
      releaseSection("## 릴리즈\n\n<!--\n- 공지: 예시\n- 할 일: 예시\n-->\n"),
    ).toEqual({ notices: [], tasks: [], skipped: [] });
  });

  it("accepts the 릴리스 spelling", () => {
    expect(releaseSection("## 릴리스\n\n- 공지: 철자\n").notices).toEqual([
      "철자",
    ]);
  });

  it("drops task-list checkboxes before reading the prefix", () => {
    expect(
      releaseSection("## 릴리즈\n\n- [ ] 할 일: 시크릿\n- [x] 공지: 완료\n"),
    ).toEqual({ notices: ["완료"], tasks: ["시크릿"], skipped: [] });
  });

  it("joins indented continuation lines to their item", () => {
    expect(
      releaseSection(
        "## 릴리즈\n\n- 할 일: prod Vault에\n  `storage_cleanup_secret`을 넣는다.\n  - 공지: 하위 항목\n",
      ),
    ).toEqual({
      notices: ["하위 항목"],
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
      notices: [],
      tasks: ["코드 뒤"],
      skipped: [],
    });
  });

  it("reports lines it could not read instead of dropping them silently", () => {
    expect(
      releaseSection(
        "## 릴리즈\n\n공지할 것 있음\n1. 할 일: 번호 목록\n- 할 일: 읽힘\n",
      ),
    ).toEqual({
      notices: [],
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

    expect(result.notices).toEqual([
      { pr: 1, text: "홈 피드에서 연 글이 읽음으로 표시됩니다." },
    ]);
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
    expect(body).toContain("`/release`");
    expect(body).toContain("| #418 | Record posts \\| read | DB |");
    expect(body).toContain(
      "- [`abcdef1`](https://github.com/o/r/commit/abcdef1) Fix typo",
    );
    expect(body).toContain("- #418: 홈 피드에서 연 글이 읽음으로 표시됩니다.");
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
  });

  it("marks a release PR body so later updates can find it", () => {
    const body = formatReleasePr({ changes, head, deploy });
    expect(body.startsWith("<!-- release-pr -->")).toBe(true);
    expect(body).toContain("## 바뀌는 동작");
    expect(body).toContain("## DB·배포");
    expect(body).toContain("Production");
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
    expect(issue).toContain(
      "- [ ] #418: 홈 피드에서 연 글이 읽음으로 표시됩니다.",
    );
    expect(issue).toContain("- [ ] #418: prod Vault에");

    expect(
      formatFollowUpIssue({
        version: "v2026.11.10",
        releaseUrl: "https://x",
        changes: { prs: [pr(1)], commits: [] },
      }),
    ).toBeNull();
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
          body: "## 릴리즈\n\n- 공지: @bob 확인, `@types/node` 갱신\n",
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
