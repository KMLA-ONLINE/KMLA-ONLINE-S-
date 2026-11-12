/**
 * 릴리즈 대기 목록, 릴리즈 PR, 릴리즈 노트, 릴리즈 후 할 일의 본문을 만든다. GitHub을 부르지 않는
 * 순수 함수만 두고, 호출은 `release.mjs`가 한다.
 *
 * `changes`는 `{ prs, commits }`다. `prs`는 `dev`에 squash merge된 PR
 * (`{ number, title, url, body, files, onMain }`), `commits`는 PR 없이 `dev`에 들어간 커밋
 * (`{ sha, message, url, onMain }`)이다. 대기 목록은 마지막 릴리즈 태그 이후의 변경이고,
 * `onMain`은 그중 `main`에 merge됐지만 prod 배포가 아직 끝나지 않았거나 실패해 태그가 없는 것이다.
 */

/** `dev` 배포를 띄우는 Vercel Preview 도메인. */
const DEV_PREVIEW_URL = "https://dev.kmla.online";

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

/** `## 제목`부터 다음 `##` 제목이나 본문 끝까지. `heading`은 정규식 조각이다. */
function sectionPattern(heading) {
  return new RegExp(
    `^##[ \\t]+${heading}[ \\t]*\\n([\\s\\S]*?)(?=^##[ \\t]|(?![\\s\\S]))`,
    "m",
  );
}

// 저장소 문서는 "릴리스"와 "릴리즈"를 섞어 쓴다.
const SECTION = sectionPattern("릴리[즈스]");
// CommonMark처럼 같은 문자로 된, 여는 것 이상 길이의 fence에서 닫힌다. 닫히지 않은 코드 블록은
// 본문 끝까지 이어진다.
const FENCE =
  /^[ \t]*((`|~)\2{2,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1\2*[ \t]*$|(?![\s\S]))/gm;
const ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;

/** 주석과 코드 블록을 뺀 PR 본문. 그 안의 `##`가 절을 끝내지 않게 한다. */
function cleanBody(body) {
  return (body ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(FENCE, "");
}

/**
 * PR 본문의 `## 릴리즈` 절에서 할 일을 읽는다. 자유롭게 쓴 본문이라 관대하게 읽는다. 목록 줄마다
 * 하나씩이고, `할 일:` 접두어는 있어도 없어도 된다. 공지는 릴리즈 후 변경 내용으로 생성하므로
 * 예전 템플릿의 `공지:` 줄은 읽지 않는다. 체크박스는 떼고, 들여쓴 이어지는 줄은 앞 항목에
 * 붙인다. 주석과 코드 블록은 무시한다. 목록이 아니어서 읽지 못한 줄은 버리지 않고 `skipped`로
 * 돌려줘 대기 목록에서 드러나게 한다.
 */
export function releaseSection(body) {
  const result = { tasks: [], skipped: [] };
  if (!body) return result;

  const section = SECTION.exec(cleanBody(body));
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
    if (tagged?.[1] !== "공지") result.tasks.push(content);
  }
  return result;
}

export function followUps({ prs }) {
  const tasks = [];
  const skipped = [];
  for (const pr of prs) {
    const section = releaseSection(pr.body);
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
  return { tasks, skipped };
}

// 사용자에게 보이는 변화를 담는 절. 리뷰 포인트·검증·DB 같은 개발자용 절은 공지에 노이즈다.
const NOTICE_SECTIONS = ["왜", "바뀌는 동작"];

// 절 안의 소제목(`###`부터)을 두 단계 내려, 모델이 다른 변경 블록(`##`)이나 절(`###`)로 읽지 않게 한다.
function sectionBody(text, heading) {
  return (
    sectionPattern(heading)
      .exec(text)?.[1]
      .replace(/^(#{3,6})(?=[ \t])/gm, (marks) =>
        "#".repeat(Math.min(marks.length + 2, 6)),
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim() ?? ""
  );
}

/**
 * 릴리즈 공지 초안을 만드는 모델에 넘길 변경 사항. 변경마다 `##` 블록이고, PR은 제목과 사용자에게
 * 보이는 절(`###`)을, PR 없이 들어간 커밋은 메시지를 넣는다. 주석과 코드 블록은 뺀다.
 */
export function noticeInput({ prs, commits }) {
  const blocks = [];
  for (const pr of prs) {
    const text = cleanBody(pr.body);
    const lines = [`## #${pr.number} ${pr.title}`];
    for (const heading of NOTICE_SECTIONS) {
      const body = sectionBody(text, heading);
      if (body) lines.push("", `### ${heading}`, "", body);
    }
    blocks.push(lines.join("\n"));
  }
  for (const commit of commits) {
    const [title, ...rest] = commit.message.replace(/\r\n/g, "\n").split("\n");
    const body = rest.join("\n").trim();
    blocks.push(
      [
        `## 커밋 ${commit.sha.slice(0, 7)} ${title}`,
        ...(body ? ["", body] : []),
      ].join("\n"),
    );
  }
  return blocks.join("\n\n") + "\n";
}

/**
 * 프롬프트는 알릴 변화가 없으면 `없음`만 출력하게 한다. 모델이 굵게·따옴표·목록 기호나
 * `없음입니다.`로 감싸도 같은 답으로 읽고, 그 낱말이 든 초안은 초안으로 둔다.
 */
export function isNothingToAnnounce(text) {
  const bare = text
    .trim()
    .replace(/^[-*+]\s+/, "")
    .replace(/[*_`'"‘’“”.。!\s]/g, "");
  return /^없음(입니다)?$/.test(bare);
}

/**
 * `notice` job 출력을 체크리스트의 공지 초안 결과로 바꾼다. 초안이 비교한 직전 릴리즈(`base`)가
 * `publish`의 것과 다르면 다른 범위의 변경을 담은 초안이라 쓰지 않는다. 앞 릴리즈의 태그가 생기기
 * 전에 다음 릴리즈의 초안을 만들면 그렇게 된다. 출력이 없으면(job 실패) 생성 실패로 본다.
 */
export function noticeFrom({ status, text, base }, expected) {
  const failed = { status: "failed", logUrl: expected.logUrl };
  if ((base || null) !== expected.base) return failed;
  if (status === "ok" && text) return { status, text };
  if (status === "none") return { status };
  return failed;
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
// 릴리즈 PR이 기본 브랜치(`main`)에 merge되면 본문의 `Fixes #350` 같은 문구가 이슈를 닫는다.
const CLOSING =
  /\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)(?=:?\s+(?:[\w.-]+\/[\w.-]+)?#\d|:?\s+https?:\/\/)/gi;

function quiet(text) {
  return text
    .split(/(`[^`\n]*`)/)
    .map((part, index) =>
      index % 2 === 1
        ? part
        : part
            .replace(/(^|[^\w`])@(?=[A-Za-z0-9])/g, "$1@\u200b")
            .replace(CLOSING, (word) => `${word[0]}\u200b${word.slice(1)}`),
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
  const { tasks, skipped } = followUps(changes);
  const bullet = checkbox ? "- [ ]" : "-";
  const lines = [];
  const group = (heading, items) => {
    if (items.length === 0) return;
    if (lines.length > 0) lines.push("");
    lines.push(heading, "", ...items);
  };

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
          `- [#${pr}](${urls.get(pr)}): \`## 릴리즈\` 절에서 읽지 못한 줄 ${count}개가 있습니다. \`- 할 일:\` 목록으로 고쳐 주세요.`,
      ),
    );
  }
  return lines.join("\n");
}

/** `/release`는 저장소 admin만 쓴다. permission API는 maintain을 write로 돌려준다. */
export function canRelease(permission) {
  return permission === "admin";
}

export function isEmpty({ prs, commits }) {
  return prs.length === 0 && commits.length === 0;
}

/** `main`에 merge됐지만 태그가 없는 변경(`merged`)과 `dev`에만 있는 변경(`devOnly`). */
export function split({ prs, commits }) {
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

export function count({ prs, commits }) {
  return prs.length + commits.length;
}

/** `main` head에 대한 `release.yml` 실행의 상태. 배포 중인 변경을 실패로 읽지 않기 위해 구분한다. */
export function releaseState(run) {
  if (!run) return { state: "unknown", url: null };
  const url = run.html_url;
  if (run.status !== "completed") return { state: "running", url };
  if (run.conclusion === "success") return { state: "deployed", url };
  return { state: "failed", url };
}

function run(url) {
  return url ? ` ([실행 기록](${url}))` : "";
}

function strandedNote(release = { state: "unknown", url: null }) {
  switch (release.state) {
    case "running":
      return `\`main\`에 merge됐고 prod 배포가 진행 중입니다${run(release.url)}.`;
    case "deployed":
      return `prod에 배포됐고 태그를 만드는 중입니다${run(release.url)}. 태그가 생기지 않으면 Release dashboard workflow의 실행 기록을 확인합니다.`;
    case "failed":
      return `\`main\`에 merge됐지만 prod 배포가 실패해 아직 태그가 없습니다${run(release.url)}. \`release.yml\`을 다시 실행하거나 다음 릴리즈와 함께 내보냅니다.`;
    default:
      return "`main`에 merge됐지만 아직 prod에 배포되지 않아 태그가 없습니다.";
  }
}

/** 직전 릴리즈 태그. 목록은 GitHub이 주는 대로 최신순이고, 지금 만드는 릴리즈는 뺀다. */
export function previousRelease(releases, exclude) {
  return (
    releases.find(
      (release) =>
        !release.draft && !release.prerelease && release.tag_name !== exclude,
    )?.tag_name ?? null
  );
}

export function followUpTitle(version) {
  return `${version} 릴리즈 후 할 일`;
}

/** `/release`에 남기는 댓글. */
export function formatReleaseComment(result) {
  switch (result.kind) {
    case "none":
      return "prod에 릴리즈할 `dev` 변경이 없습니다.";
    case "stranded":
      return `\`main\`에 없는 \`dev\` 변경이 없어 릴리즈 PR을 만들지 않았습니다. 배포되지 않은 변경 ${result.count}개: ${strandedNote(result.release)}`;
    case "not-deployed":
      return `\`dev\` head ${short(result.head.sha)}의 배포가 아직 성공하지 않아 릴리즈 PR을 만들지 않았습니다${result.deploy ? run(result.deploy.url) : ""}. 배포가 끝난 뒤 다시 \`/release\`를 남겨 주세요.`;
    case "manual-pr":
      return `이미 열린 \`dev\` → \`main\` PR #${result.number}이 있습니다. 직접 만든 PR이라 본문은 바꾸지 않았습니다.`;
    // 열린 릴리즈 PR은 head가 `dev`를 따라가고 본문은 `dev` 배포마다 갱신되므로 다시 쓰지 않는다.
    case "already-open": {
      const lines = [
        `릴리즈 PR #${result.number}이 이미 열려 있습니다. head는 \`dev\`를 따라가고 본문은 \`dev\` 배포마다 자동으로 갱신됩니다. 현재 \`dev\` head ${short(result.head.sha)}의 배포: ${deployStatus(result.deploy)}`,
      ];
      if (result.deploy?.conclusion !== "success") {
        lines.push(
          "",
          "이 커밋의 `dev` 배포가 성공하지 않았습니다. merge 전에 배포 결과를 확인해 주세요.",
        );
      }
      return lines.join("\n");
    }
    default: {
      const lines = [
        `릴리즈 PR을 만들었습니다: #${result.number} (\`dev\` ${short(result.head.sha)}). merge하면 CI 뒤 곧바로 prod에 배포됩니다.`,
      ];
      // 배포를 확인한 head와 PR이 열린 head 사이에 dev가 움직였을 수 있다.
      if (result.actualSha && result.actualSha !== result.head.sha) {
        lines.push(
          "",
          `확인하는 사이 \`dev\`가 ${short(result.actualSha)}로 바뀌어 PR에는 이 커밋이 들어갔습니다. 이 커밋의 \`dev\` 배포가 성공했는지 확인한 뒤 merge해 주세요. 배포가 끝나면 대기 목록과 PR 본문이 갱신됩니다.`,
        );
      }
      return lines.join("\n");
    }
  }
}

export function formatDashboard({
  changes,
  head,
  deploy,
  releasePr,
  lastRelease = null,
  release,
}) {
  const lines = [
    "<!-- release-dashboard -->",
    "prod에 아직 나가지 않은 변경입니다. 마지막 릴리즈 태그와 `dev`를 비교하며, `dev` 배포와 릴리즈가 끝날 때마다 자동으로 갱신됩니다.",
    "",
    "| `dev` head | `dev` 배포 | `dev` 미리보기 | 마지막 릴리즈 | 릴리즈 PR |",
    "| --- | --- | --- | --- | --- |",
    `| [${short(head.sha)}](${head.url}) | ${deployStatus(deploy)} | [${new URL(DEV_PREVIEW_URL).host}](${DEV_PREVIEW_URL}) | ${lastRelease ? `[${lastRelease.tag}](${lastRelease.url})` : "없음"} | ${releasePr ? `#${releasePr}` : "없음"} |`,
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
      strandedNote(release),
      "",
      changeList(merged),
      "",
    );
  }
  if (!isEmpty(devOnly)) {
    lines.push(
      `## 릴리즈 대기 (${count(devOnly)})`,
      "",
      "이 이슈에 `/release`라고 댓글을 남기면 `dev` → `main` 릴리즈 PR을 만듭니다. 저장소 admin만 쓸 수 있고, `dev` head의 배포가 성공했을 때만 만듭니다. 이미 열려 있으면 그 PR과 `dev` 배포 상태를 알려 줍니다.",
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
      "merge하면 `release.yml`이 CI를 돌린 뒤 곧바로 prod에 배포합니다. 배포 전에 필요한 일(prod 시크릿 등)은 merge 전에 끝냅니다. 릴리즈가 끝나면 아래 항목이 체크리스트 이슈로 열립니다.",
      "",
      followUp,
    );
  } else {
    lines.push(
      "",
      "## DB·배포",
      "",
      "merge하면 `release.yml`이 CI를 돌린 뒤 곧바로 prod에 배포합니다.",
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

/** 원문 안의 가장 긴 backtick fence보다 길게 감싸 초안이 코드 블록을 끝내지 않게 한다. */
function rawBlock(text) {
  const longest = Math.max(
    2,
    ...(text.match(/`{3,}/g) ?? []).map((run) => run.length),
  );
  const fence = "`".repeat(longest + 1);
  return [`${fence}markdown`, text.trimEnd(), fence].join("\n");
}

/**
 * 릴리즈 후 공지 초안 절. `notice`는 `notice` job의 결과다: 생성한 초안(`ok`), 알릴 변화 없음
 * (`none`), 생성 실패(`failed`). 알릴 변화가 없으면 할 일이 없을 때 이슈를 열지 않는다.
 */
function noticeDraft(notice) {
  switch (notice?.status) {
    case "ok":
      return {
        required: true,
        lines: [
          "### 공지 초안",
          "",
          "- [ ] 아래 초안을 다듬어 공지합니다.",
          "",
          rawBlock(notice.text),
        ],
      };
    case "none":
      return {
        required: false,
        lines: ["### 공지 초안", "", "공지할 변화가 없습니다."],
      };
    case "failed":
      return {
        required: true,
        lines: [
          "### 공지 초안",
          "",
          `- [ ] 공지 초안을 만들지 못했습니다. 이번 릴리즈의 변경 목록을 보고 직접 작성합니다${run(notice.logUrl)}.`,
        ],
      };
    default:
      return { required: false, lines: [] };
  }
}

export function formatFollowUpIssue({ version, releaseUrl, changes, notice }) {
  const followUp = followUpList(changes, { checkbox: true });
  const draft = noticeDraft(notice);
  if (!followUp && !draft.required) return null;
  const lines = [
    `[${version}](${releaseUrl}) 릴리즈 후 확인할 항목입니다. 끝나면 이 이슈를 닫습니다.`,
    "",
  ];
  if (draft.lines.length > 0) lines.push(...draft.lines, "");
  if (followUp) lines.push(followUp);
  return lines.join("\n").trimEnd() + "\n";
}
