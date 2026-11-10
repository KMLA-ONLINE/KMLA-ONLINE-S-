/**
 * 릴리즈 대기 목록, 릴리즈 PR, 릴리즈 노트, 릴리즈 후 할 일의 본문을 만든다. GitHub을 부르지 않는
 * 순수 함수만 두고, 호출은 `release.mjs`가 한다.
 *
 * `changes`는 `{ prs, commits }`다. `prs`는 `dev`에 squash merge된 PR
 * (`{ number, title, url, body, files, onMain }`), `commits`는 PR 없이 `dev`에 들어간 커밋
 * (`{ sha, message, url, onMain }`)이다. 대기 목록은 마지막 릴리즈 태그 이후의 변경이고,
 * `onMain`은 그중 `main`에 merge됐지만 prod 배포가 거부되거나 실패해 태그가 없는 것이다.
 */

/** 원격 Supabase에 배포되는 경로. `schema-changes.mjs`도 이 목록을 쓴다. */
export const REMOTE_PATHS = [
  /^supabase\/migrations\//,
  /^supabase\/schemas\//,
  /^supabase\/functions\//,
  /^supabase\/config\.toml$/,
];

// 릴리즈 workflow가 바꾸지 않는 프로젝트별 설정은 변경 파일로 알아차리고 할 일로 남긴다
// (docs/DOCKER.md §5.2).
const IMPACTS = [
  { name: "DB", pattern: /^supabase\/(migrations|schemas)\// },
  { name: "Edge Function", pattern: /^supabase\/functions\// },
  {
    name: "`VITE_*` 변수",
    pattern: /^\.env\.example$/,
    task: "Vercel Production 스코프의 `VITE_*` 값을 확인합니다 (`.env.example` 변경).",
  },
  {
    name: "Function 시크릿",
    pattern: /^supabase\/\.env\.example$/,
    task: "prod Edge Function 시크릿을 확인합니다 (`supabase/.env.example` 변경).",
  },
  {
    name: "`config.toml`",
    pattern: /^supabase\/config\.toml$/,
    task: "prod Dashboard 설정(Auth 등)에 반영할 것이 있는지 확인합니다. `config push`는 쓰지 않습니다.",
  },
];

export function impacts(files) {
  return IMPACTS.filter(({ pattern }) =>
    files.some((file) => pattern.test(file)),
  ).map(({ name }) => name);
}

// 저장소 문서는 "릴리스"와 "릴리즈"를 섞어 쓴다.
const SECTION = /^##[ \t]+릴리[즈스][ \t]*\n([\s\S]*?)(?=^##[ \t]|(?![\s\S]))/m;
// 닫히지 않은 코드 블록은 본문 끝까지 이어진다.
const FENCE =
  /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[ \t]*$|(?![\s\S]))/gm;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/**
 * PR 본문의 `## 릴리즈` 절에서 공지와 할 일을 읽는다. 자유롭게 쓴 본문이라 관대하게 읽는다.
 * 목록 줄마다 하나씩, `공지:`로 시작하면 공지, 나머지는 할 일이다. 체크박스는 떼고, 들여쓴
 * 이어지는 줄은 앞 항목에 붙인다. 주석과 코드 블록은 무시한다. 목록이 아니어서 읽지 못한 줄은
 * 버리지 않고 `skipped`로 돌려줘 대기 목록에서 드러나게 한다.
 */
export function releaseSection(body) {
  const result = { notices: [], tasks: [], skipped: [] };
  if (!body) return result;

  const text = body
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(FENCE, "");
  const section = SECTION.exec(text);
  if (!section) return result;

  const items = [];
  let current = null;
  for (const line of section[1].split("\n")) {
    if (!line.trim()) continue;
    const item = ITEM.exec(line);
    if (item) {
      current = { text: item[1].trim() };
      items.push(current);
    } else if (current && /^\s/.test(line)) {
      current.text += ` ${line.trim()}`;
    } else {
      result.skipped.push(line.trim());
      current = null;
    }
  }

  for (const item of items) {
    const unchecked = item.text.replace(/^\[[ xX]\]\s*/, "");
    const tagged = /^(공지|할 일)\s*[:：]\s*(.*)$/.exec(unchecked);
    const content = (tagged ? tagged[2] : unchecked).trim();
    if (!content) continue;
    if (tagged?.[1] === "공지") result.notices.push(content);
    else result.tasks.push(content);
  }
  return result;
}

export function followUps({ prs }) {
  const notices = [];
  const tasks = [];
  const skipped = [];
  for (const pr of prs) {
    const section = releaseSection(pr.body);
    for (const text of section.notices) notices.push({ pr: pr.number, text });
    for (const text of section.tasks) tasks.push({ pr: pr.number, text });
    for (const { pattern, task } of IMPACTS) {
      if (task && pr.files.some((file) => pattern.test(file))) {
        tasks.push({ pr: pr.number, text: task });
      }
    }
    if (section.skipped.length > 0) {
      skipped.push({ pr: pr.number, count: section.skipped.length });
    }
  }
  return { notices, tasks, skipped };
}

/**
 * 한국 날짜의 CalVer 태그. 그날 첫 릴리즈는 `v2026.11.10`, 다음부터 `v2026.11.10.2`다. semver
 * 파서가 읽을 수 있도록 0을 채우지 않는다.
 */
export function nextVersion(now, tags) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    })
      .formatToParts(now)
      .map(({ type, value }) => [type, value]),
  );
  const base = `v${parts.year}.${parts.month}.${parts.day}`;

  let last = 0;
  for (const tag of tags) {
    if (tag === base) last = Math.max(last, 1);
    const match =
      tag.startsWith(`${base}.`) && /^\d+$/.exec(tag.slice(base.length + 1));
    if (match) last = Math.max(last, Number(match[0]));
  }
  return last === 0 ? base : `${base}.${last + 1}`;
}

/**
 * PR 본문·제목을 옮겨 적을 때 `@멘션`이 알림을 보내지 않게 `@` 뒤에 폭 없는 공백을 넣는다.
 * 코드 span 안은 GitHub이 멘션으로 보지 않으므로 그대로 둔다.
 */
function quiet(text) {
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part.replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@\u200b"),
    )
    .join("");
}

function cell(text) {
  return quiet(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function short(sha) {
  return `\`${sha.slice(0, 7)}\``;
}

function subject(message) {
  return quiet(message.split("\n")[0]);
}

function deployStatus(deploy) {
  if (!deploy) return "없음";
  const label =
    {
      success: "성공",
      failure: "실패",
      cancelled: "취소",
      skipped: "건너뜀",
    }[deploy.conclusion] ?? "진행 중";
  return `[${label}](${deploy.url})`;
}

function changeList({ prs, commits }) {
  const lines = [];
  if (prs.length > 0) {
    lines.push("| PR | 제목 | 배포 영향 |", "| --- | --- | --- |");
    for (const pr of prs) {
      lines.push(
        `| #${pr.number} | ${cell(pr.title)} | ${impacts(pr.files).join(", ") || "-"} |`,
      );
    }
  }
  if (commits.length > 0) {
    if (lines.length > 0) lines.push("");
    lines.push("PR 없이 들어간 커밋:", "");
    for (const commit of commits) {
      lines.push(
        `- [${short(commit.sha)}](${commit.url}) ${subject(commit.message)}`,
      );
    }
  }
  return lines.join("\n");
}

function followUpList(changes, { checkbox }) {
  const { notices, tasks, skipped } = followUps(changes);
  const bullet = checkbox ? "- [ ]" : "-";
  const lines = [];
  const group = (heading, items) => {
    if (items.length === 0) return;
    if (lines.length > 0) lines.push("");
    lines.push(heading, "", ...items);
  };

  group(
    "### 공지",
    notices.map(({ pr, text }) => `${bullet} #${pr}: ${quiet(text)}`),
  );
  group(
    "### 할 일",
    tasks.map(({ pr, text }) => `${bullet} #${pr}: ${quiet(text)}`),
  );
  // 체크리스트 이슈에서는 놓친 내용을 사람이 PR에서 확인할 할 일로 남긴다.
  if (checkbox) {
    group(
      "### 읽지 못한 줄",
      skipped.map(
        ({ pr, count }) =>
          `- [ ] #${pr}: \`## 릴리즈\` 절에서 읽지 못한 줄 ${count}개를 PR에서 직접 확인합니다.`,
      ),
    );
  } else {
    const urls = new Map(changes.prs.map((pr) => [pr.number, pr.url]));
    group(
      "### 읽지 못한 줄",
      skipped.map(
        ({ pr, count }) =>
          `- [#${pr}](${urls.get(pr)}): \`## 릴리즈\` 절에서 읽지 못한 줄 ${count}개가 있습니다. \`- 공지:\`나 \`- 할 일:\` 목록으로 고쳐 주세요.`,
      ),
    );
  }
  return lines.join("\n");
}

/** `/release`는 저장소 admin만 쓴다. permission API는 maintain을 write로 돌려준다. */
export function canRelease(permission) {
  return permission === "admin";
}

function isEmpty({ prs, commits }) {
  return prs.length === 0 && commits.length === 0;
}

function split({ prs, commits }) {
  return {
    merged: {
      prs: prs.filter((pr) => pr.onMain),
      commits: commits.filter((commit) => commit.onMain),
    },
    devOnly: {
      prs: prs.filter((pr) => !pr.onMain),
      commits: commits.filter((commit) => !commit.onMain),
    },
  };
}

function count({ prs, commits }) {
  return prs.length + commits.length;
}

export function formatDashboard({
  changes,
  head,
  deploy,
  releasePr,
  lastRelease = null,
}) {
  const lines = [
    "<!-- release-dashboard -->",
    "prod에 아직 나가지 않은 변경입니다. 마지막 릴리즈 태그와 `dev`를 비교하며, `dev` 배포와 릴리즈가 끝날 때마다 자동으로 갱신됩니다.",
    "",
    "| `dev` head | `dev` 배포 | 마지막 릴리즈 | 릴리즈 PR |",
    "| --- | --- | --- | --- |",
    `| [${short(head.sha)}](${head.url}) | ${deployStatus(deploy)} | ${lastRelease ? `[${lastRelease.tag}](${lastRelease.url})` : "없음"} | ${releasePr ? `#${releasePr}` : "없음"} |`,
    "",
  ];

  if (isEmpty(changes)) {
    lines.push("릴리즈할 변경이 없습니다.");
    return lines.join("\n") + "\n";
  }

  const { merged, devOnly } = split(changes);
  if (!isEmpty(merged)) {
    lines.push(
      `## prod 배포 대기 (${count(merged)})`,
      "",
      "`main`에 merge됐지만 prod 배포가 거부되거나 실패해 아직 태그가 없습니다. `release.yml`을 다시 실행하거나 다음 릴리즈와 함께 내보냅니다.",
      "",
      changeList(merged),
      "",
    );
  }
  if (!isEmpty(devOnly)) {
    lines.push(
      `## 릴리즈 대기 (${count(devOnly)})`,
      "",
      "이 이슈에 `/release`라고 댓글을 남기면 `dev` → `main` 릴리즈 PR을 만들거나 갱신합니다. 저장소 admin만 쓸 수 있고, `dev` head의 배포가 성공했을 때만 만듭니다.",
      "",
      changeList(devOnly),
      "",
    );
  }
  const followUp = followUpList(changes, { checkbox: false });
  if (followUp) lines.push("## 릴리즈 후 정리될 항목", "", followUp, "");
  return lines.join("\n");
}

export function formatReleasePr({ changes, head, deploy }) {
  const { merged, devOnly } = split(changes);
  const lines = [
    "<!-- release-pr -->",
    "<!-- release-dashboard workflow가 dev 배포마다 이 본문을 다시 씁니다. 직접 고친 내용은 사라집니다. -->",
    "",
    "## 왜",
    "",
    `\`dev\` [${short(head.sha)}](${head.url})를 \`main\`에 릴리즈합니다. \`dev\` 배포: ${deployStatus(deploy)}`,
    "",
    "## 바뀌는 동작",
    "",
    changeList(devOnly),
  ];
  if (!isEmpty(merged)) {
    lines.push(
      "",
      "이전에 `main`에 merge됐지만 prod에 배포되지 않은 변경도 이 릴리즈와 함께 나갑니다.",
      "",
      changeList(merged),
    );
  }
  const followUp = followUpList(changes, { checkbox: false });
  if (followUp) {
    lines.push(
      "",
      "## DB·배포",
      "",
      "merge하면 `release.yml`이 CI 뒤 `Production` Environment 승인을 기다립니다. 승인 전에 해야 할 일이 있다면 먼저 끝냅니다. 릴리즈가 끝나면 아래 항목이 체크리스트 이슈로 열립니다.",
      "",
      followUp,
    );
  } else {
    lines.push(
      "",
      "## DB·배포",
      "",
      "merge하면 `release.yml`이 CI 뒤 `Production` Environment 승인을 기다립니다.",
    );
  }
  return lines.join("\n") + "\n";
}

export function formatReleaseNotes({ changes }) {
  const lines = [];
  for (const pr of changes.prs) {
    lines.push(`- ${quiet(pr.title)} (#${pr.number})`);
  }
  for (const commit of changes.commits) {
    lines.push(`- ${subject(commit.message)} (${short(commit.sha)})`);
  }
  return (
    (lines.length > 0 ? lines.join("\n") : "변경 목록을 찾지 못했습니다.") +
    "\n"
  );
}

export function formatFollowUpIssue({ version, releaseUrl, changes }) {
  const followUp = followUpList(changes, { checkbox: true });
  if (!followUp) return null;
  return (
    [
      `[${version}](${releaseUrl}) 릴리즈 후 확인할 항목입니다. 끝나면 이 이슈를 닫습니다.`,
      "",
      followUp,
    ].join("\n") + "\n"
  );
}
