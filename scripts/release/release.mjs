/**
 * `.github/workflows/release-dashboard.yml`이 부르는 릴리즈 정리 단계. 본문은 `plan.mjs`가 만들고,
 * 여기서는 GitHub API만 부른다. `GITHUB_TOKEN`과 `GITHUB_REPOSITORY`가 필요하다.
 *
 *   node scripts/release/release.mjs dashboard
 *     마지막 릴리즈 태그...`dev`의 변경으로 릴리즈 대기 목록 이슈를 갱신하고, 없으면 만든다. 그중
 *     `main`에 이미 있는 것은 `main` head의 `release.yml` 상태와 함께 prod 배포 대기로 따로
 *     보인다. 이 workflow가 만든 릴리즈 PR이 열려 있으면 그 본문도 다시 쓴다. `DRY_RUN=1`이면
 *     쓰지 않고 본문만 출력한다. 대기 목록을 쓰는 것은 이 명령뿐이라, workflow가 한 concurrency
 *     group에서 차례로 실행한다.
 *
 *   node scripts/release/release.mjs authorize
 *     `COMMENTER`가 저장소 admin인지, `COMMENT_BODY`가 `/release`인지 확인하고
 *     `allowed` 출력을 남긴다.
 *
 *   node scripts/release/release.mjs release-pr
 *     `dev` head의 배포가 성공했으면 `dev` → `main` PR을 만들고 `ISSUE`에 결과를 댓글로 남긴다.
 *     이미 열려 있으면 다시 쓰지 않고 그 PR과 `dev` 배포 상태를 알린다. PR은 `RELEASE_PR_TOKEN`(GitHub App)으로 만든다. `GITHUB_TOKEN`이 만든 PR에는
 *     `pull_request` workflow가 돌지 않아 CI가 빠지기 때문이다.
 *
 *   node scripts/release/release.mjs notice
 *     `release.yml`이 `RELEASED_SHA`를 prod에 배포한 뒤, 이번 릴리즈의 변경으로 Gemini
 *     (`GEMINI_API_KEY`, `GEMINI_MODEL`)에 사용자 공지 초안을 받아 `status`(`ok`·`none`·`failed`·
 *     `exists`)와 `text` 출력을 남긴다. 실패해도 릴리즈 정리를 막지 않도록 `failed`로 끝난다.
 *     `DRY_RUN=1`이면 모델 입력을 출력하고, 키가 있으면 초안도 출력한다.
 *
 *   node scripts/release/release.mjs publish
 *     `release.yml`이 `RELEASED_SHA`를 prod에 배포한 뒤, 그 커밋에 CalVer 태그와 GitHub Release를
 *     만들고 공지 초안(`NOTICE_STATUS`, `NOTICE_TEXT`)이나 릴리즈 후 할 일이 있으면 체크리스트
 *     이슈를 연다. 단계마다 이미 됐는지 확인하므로 실패한 뒤 다시 실행해도 빠진 단계만 채운다.
 */
import { randomUUID } from "node:crypto";
import { appendFile, readFile } from "node:fs/promises";

import {
  canRelease,
  count,
  followUpTitle,
  formatDashboard,
  formatFollowUpIssue,
  formatReleaseComment,
  formatReleaseNotes,
  formatReleasePr,
  isEmpty,
  nextVersion,
  isNothingToAnnounce,
  noticeFrom,
  noticeInput,
  previousRelease,
  releaseState,
  split,
} from "./plan.mjs";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const SERVER = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const DASHBOARD_LABEL = "release-dashboard";
const DASHBOARD_TITLE = "릴리즈 대기 목록";
const DASHBOARD_MARKER = "<!-- release-dashboard -->";
const RELEASE_PR_MARKER = "<!-- release-pr -->";
const RELEASE_PR_TITLE = "Release dev to main";
const FOLLOW_UP_LABEL = "release-follow-up";
const CALVER = /^v\d+\.\d+\.\d+(\.\d+)?$/;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment value: ${name}`);
  return value;
}

const REPO = env("GITHUB_REPOSITORY");
const OWNER = REPO.split("/")[0];

async function request(
  pathname,
  { method = "GET", body, token = env("GITHUB_TOKEN"), allow = [] } = {},
) {
  const url = pathname.startsWith("http") ? pathname : `${API}${pathname}`;
  const response = await fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok && !allow.includes(response.status)) {
    throw new Error(
      `GitHub ${method} ${new URL(url).pathname} failed with ${response.status}: ${text}`,
    );
  }
  return {
    status: response.status,
    data: text ? JSON.parse(text) : null,
    next: /<([^>]+)>;\s*rel="next"/.exec(
      response.headers.get("link") ?? "",
    )?.[1],
  };
}

async function api(pathname, options) {
  return (await request(pathname, options)).data;
}

/** 배열 응답이나 `pick`이 고른 배열을 모든 페이지에서 모은다. */
async function paginate(pathname, pick = (data) => data) {
  const items = [];
  let url = pathname;
  while (url) {
    const { data, next } = await request(url);
    items.push(...pick(data));
    url = next;
  }
  return items;
}

async function output(key, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  // 여러 줄 값은 GitHub이 정한 heredoc 형식으로 쓴다.
  const line = value.includes("\n")
    ? (() => {
        const delimiter = `EOF_${randomUUID()}`;
        return `${key}<<${delimiter}\n${value}\n${delimiter}\n`;
      })()
    : `${key}=${value}\n`;
  await appendFile(process.env.GITHUB_OUTPUT, line);
}

// ── 변경 목록 ────────────────────────────────────────────────────────────────

/**
 * 커밋마다 `dev`에 merge된 PR을 찾는다. `dev`는 squash merge라서 커밋 하나가 PR 하나다. 변경
 * 파일은 배포 영향과 할 일에만 쓰므로, 공지 초안처럼 필요 없으면 `files: false`로 건너뛴다.
 */
async function changesFrom(
  commits,
  onMain = () => false,
  { files: withFiles = true } = {},
) {
  const prs = new Map();
  const direct = [];
  for (const commit of commits) {
    if (commit.parents.length > 1) continue;
    const pulls = await api(`/repos/${REPO}/commits/${commit.sha}/pulls`);
    const pr = pulls.find((pull) => pull.base.ref === "dev" && pull.merged_at);
    if (!pr) {
      direct.push({
        sha: commit.sha,
        message: commit.commit.message,
        url: commit.html_url,
        onMain: onMain(commit.sha),
      });
    } else if (!prs.has(pr.number)) {
      prs.set(pr.number, { pr, onMain: onMain(commit.sha) });
    }
  }

  const resolved = [];
  for (const { pr, onMain: merged } of prs.values()) {
    const files = withFiles
      ? await paginate(`/repos/${REPO}/pulls/${pr.number}/files?per_page=100`)
      : [];
    resolved.push({
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      body: pr.body,
      files: files.flatMap((file) =>
        file.previous_filename
          ? [file.filename, file.previous_filename]
          : [file.filename],
      ),
      onMain: merged,
    });
  }
  return { prs: resolved, commits: direct };
}

async function compareCommits(base, head) {
  return paginate(
    `/repos/${REPO}/compare/${base}...${head}?per_page=100`,
    (data) => data.commits,
  );
}

/** prod에 마지막으로 나간 릴리즈. 태그는 배포가 성공한 커밋에만 생긴다. */
async function latestRelease() {
  const { status, data } = await request(`/repos/${REPO}/releases/latest`, {
    allow: [404],
  });
  return status === 404 ? null : { tag: data.tag_name, url: data.html_url };
}

/**
 * prod에 없는 `dev` 변경. `main...dev`만 보면 merge 뒤 배포 중이거나 실패한 변경이 목록에서
 * 사라지므로 마지막 릴리즈 태그와 비교하고, `main...dev`에 없는 것을 `onMain`으로 표시한다.
 */
async function pendingChanges(lastRelease) {
  if (!lastRelease) return changesFrom(await compareCommits("main", "dev"));
  const [pending, devOnly] = await Promise.all([
    compareCommits(lastRelease.tag, "dev"),
    compareCommits("main", "dev"),
  ]);
  const unmerged = new Set(devOnly.map((commit) => commit.sha));
  return changesFrom(pending, (sha) => !unmerged.has(sha));
}

/** `main` head에 대한 `release.yml` 실행. 배포 중·실패·완료를 구분하는 데 쓴다. */
async function mainRelease() {
  const branch = await api(`/repos/${REPO}/branches/main`);
  const { workflow_runs: runs } = await api(
    `/repos/${REPO}/actions/workflows/release.yml/runs?branch=main&head_sha=${branch.commit.sha}&per_page=1`,
  );
  return releaseState(runs[0] ?? null);
}

/** 대기 목록과 릴리즈 PR에 필요한 상태를 한 번에 읽는다. */
async function snapshot() {
  const [lastRelease, head, pr, release] = await Promise.all([
    latestRelease(),
    devHead(),
    openReleasePr(),
    mainRelease(),
  ]);
  const [changes, deploy] = await Promise.all([
    pendingChanges(lastRelease),
    devDeploy(head.sha),
  ]);
  return { changes, head, deploy, pr, lastRelease, release };
}

async function devHead() {
  const branch = await api(`/repos/${REPO}/branches/dev`);
  return {
    sha: branch.commit.sha,
    url: `${SERVER}/${REPO}/commit/${branch.commit.sha}`,
  };
}

async function devDeploy(sha) {
  const { workflow_runs: runs } = await api(
    `/repos/${REPO}/actions/workflows/deploy-dev.yml/runs?branch=dev&head_sha=${sha}&per_page=1`,
  );
  const run = runs[0];
  return run ? { conclusion: run.conclusion, url: run.html_url } : null;
}

async function openReleasePr() {
  const pulls = await api(
    `/repos/${REPO}/pulls?state=open&base=main&head=${OWNER}:dev`,
  );
  return pulls[0] ?? null;
}

// ── 이슈 ─────────────────────────────────────────────────────────────────────

async function ensureLabel(name, color, description) {
  await request(`/repos/${REPO}/labels`, {
    method: "POST",
    body: { name, color, description },
    allow: [422],
  });
}

async function comment(issue, body) {
  await api(`/repos/${REPO}/issues/${issue}/comments`, {
    method: "POST",
    body: { body },
  });
}

async function findDashboard() {
  const issues = await api(
    `/repos/${REPO}/issues?state=open&labels=${DASHBOARD_LABEL}&per_page=20`,
  );
  return (
    issues.find(
      (issue) =>
        !issue.pull_request && issue.body?.startsWith(DASHBOARD_MARKER),
    ) ?? null
  );
}

// 고정은 편의일 뿐이라 실패해도 목록 갱신은 계속한다.
async function pin(issue) {
  try {
    const response = await request(`${API}/graphql`, {
      method: "POST",
      body: {
        query:
          "mutation($id: ID!) { pinIssue(input: { issueId: $id }) { issue { number } } }",
        variables: { id: issue.node_id },
      },
    });
    if (response.data?.errors)
      throw new Error(JSON.stringify(response.data.errors));
  } catch (error) {
    console.warn(`Could not pin #${issue.number}: ${error.message}`);
  }
}

async function dashboard() {
  const { changes, head, deploy, pr, lastRelease, release } = await snapshot();
  const body = formatDashboard({
    changes,
    head,
    deploy,
    releasePr: pr?.number ?? null,
    lastRelease,
    release,
  });

  if (process.env.DRY_RUN) {
    console.log(body);
    if (pr) console.log(formatReleasePr({ changes, head, deploy }));
    return;
  }

  const existing = await findDashboard();
  if (existing) {
    if (existing.body !== body) {
      await api(`/repos/${REPO}/issues/${existing.number}`, {
        method: "PATCH",
        body: { body },
      });
    }
  } else {
    await ensureLabel(
      DASHBOARD_LABEL,
      "0E8A16",
      "Pending dev changes for release",
    );
    const issue = await api(`/repos/${REPO}/issues`, {
      method: "POST",
      body: { title: DASHBOARD_TITLE, body, labels: [DASHBOARD_LABEL] },
    });
    await pin(issue);
  }

  // 사람이 직접 연 dev → main PR의 본문은 건드리지 않는다.
  if (pr?.body?.startsWith(RELEASE_PR_MARKER)) {
    const prBody = formatReleasePr({ changes, head, deploy });
    if (pr.body !== prBody) {
      await api(`/repos/${REPO}/pulls/${pr.number}`, {
        method: "PATCH",
        body: { body: prBody },
      });
    }
  }
}

// ── /release ─────────────────────────────────────────────────────────────────

async function authorize() {
  const commenter = env("COMMENTER");
  if ((process.env.COMMENT_BODY ?? "").trim() !== "/release") {
    await output("allowed", "false");
    return;
  }
  const { permission } = await api(
    `/repos/${REPO}/collaborators/${encodeURIComponent(commenter)}/permission`,
  );
  const allowed = canRelease(permission);
  if (!allowed) {
    await comment(
      env("ISSUE"),
      `@${commenter} \`/release\`는 저장소 admin만 쓸 수 있습니다.`,
    );
  }
  await output("allowed", String(allowed));
}

async function releasePr() {
  const issue = env("ISSUE");
  const { changes, head, deploy, pr: existing, release } = await snapshot();
  const { merged, devOnly } = split(changes);

  if (isEmpty(devOnly)) {
    await comment(
      issue,
      formatReleaseComment(
        isEmpty(merged)
          ? { kind: "none" }
          : { kind: "stranded", count: count(merged), release },
      ),
    );
    return;
  }
  if (existing) {
    await comment(
      issue,
      formatReleaseComment(
        existing.body?.startsWith(RELEASE_PR_MARKER)
          ? { kind: "already-open", number: existing.number, head, deploy }
          : { kind: "manual-pr", number: existing.number },
      ),
    );
    return;
  }
  if (deploy?.conclusion !== "success") {
    await comment(
      issue,
      formatReleaseComment({ kind: "not-deployed", head, deploy }),
    );
    return;
  }

  // 응답의 head를 배포를 확인한 head와 비교한다. 그 사이 `dev`가 움직였을 수 있다.
  const pr = await api(`/repos/${REPO}/pulls`, {
    method: "POST",
    token: env("RELEASE_PR_TOKEN"),
    body: {
      title: RELEASE_PR_TITLE,
      head: "dev",
      base: "main",
      body: formatReleasePr({ changes, head, deploy }),
    },
  });
  await comment(
    issue,
    formatReleaseComment({
      kind: "opened",
      number: pr.number,
      head,
      actualSha: pr.head.sha,
    }),
  );
}

// ── 릴리즈 후 ────────────────────────────────────────────────────────────────

/**
 * 이번 배포로 prod에 처음 나간 변경. 직전 릴리즈 태그와 비교하므로 배포가 실패했던 이전 릴리즈 PR의
 * 변경도 함께 들어간다. 첫 릴리즈는 비교할 태그가 없어 그 커밋의 첫 parent(merge 전 `main`)와
 * 비교한다. PR 커밋 목록은 250개에서 잘리지만 compare는 끝까지 페이지를 넘긴다.
 */
async function releasedChanges(sha, version, options) {
  const releases = await api(`/repos/${REPO}/releases?per_page=30`);
  const tag = previousRelease(releases, version);
  const base =
    tag ?? (await api(`/repos/${REPO}/commits/${sha}`)).parents[0]?.sha ?? null;
  return {
    // 공지 초안과 체크리스트가 같은 범위를 봤는지 `publish`가 비교한다.
    base,
    changes: base
      ? await changesFrom(await compareCommits(base, sha), undefined, options)
      : { prs: [], commits: [] },
  };
}

async function findRelease(tag) {
  const { status, data } = await request(
    `/repos/${REPO}/releases/tags/${encodeURIComponent(tag)}`,
    { allow: [404] },
  );
  return status === 404 ? null : data;
}

async function findFollowUp(title) {
  const issues = await paginate(
    `/repos/${REPO}/issues?state=all&labels=${FOLLOW_UP_LABEL}&per_page=100`,
  );
  return issues.find((issue) => issue.title === title) ?? null;
}

/** 이 커밋에 이미 태그가 있으면 그 태그, 없으면 다음 CalVer. */
async function releaseVersion(sha) {
  const tags = await paginate(`/repos/${REPO}/tags?per_page=100`);
  const tagged = tags.find(
    (tag) => tag.commit.sha === sha && CALVER.test(tag.name),
  );
  return {
    tagged: Boolean(tagged),
    version:
      tagged?.name ??
      nextVersion(
        new Date(),
        tags.map((tag) => tag.name),
      ),
  };
}

// ── 공지 초안 ────────────────────────────────────────────────────────────────

const GEMINI_API = "https://generativelanguage.googleapis.com/v1beta";
const NOTICE_PROMPT = new URL("./notice-prompt.md", import.meta.url);

/** 지시는 system instruction, 변경 사항은 user 메시지로 나눠 PR 본문이 지시로 읽히지 않게 한다. */
async function generateNotice(input) {
  const model = env("GEMINI_MODEL");
  const prompt = await readFile(NOTICE_PROMPT, "utf8");
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: prompt }] },
    contents: [{ role: "user", parts: [{ text: `변경 사항:\n\n${input}` }] }],
  });

  // 일시 오류와 곧 풀리는 분당 할당량에만 한 번 다시 시도한다. 일일 할당량이 바닥나면 응답의
  // `retryDelay`가 길거나 없으므로 바로 실패로 넘긴다.
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(
      `${GEMINI_API}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": env("GEMINI_API_KEY"),
        },
        body,
        signal: AbortSignal.timeout(180_000),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      const wait =
        response.status >= 500 ? 10 : retryDelay(text, response.status);
      if (attempt < 2 && wait !== null && wait <= 60) {
        await new Promise((resolve) => setTimeout(resolve, wait * 1000));
        continue;
      }
      throw new Error(`Gemini failed with ${response.status}: ${text}`);
    }

    const candidate = JSON.parse(text).candidates?.[0];
    if (candidate?.finishReason !== "STOP") {
      throw new Error(
        `Gemini stopped with ${candidate?.finishReason ?? "no candidate"}: ${text}`,
      );
    }
    const notice = (candidate.content?.parts ?? [])
      .filter((part) => !part.thought)
      .map((part) => part.text ?? "")
      .join("")
      .trim();
    if (!notice) throw new Error(`Gemini returned no text: ${text}`);
    return notice;
  }
}

/** 429 응답의 `google.rpc.RetryInfo` 대기 시간(초). 없으면 `null`. */
function retryDelay(text, status) {
  if (status !== 429) return null;
  try {
    const delay = JSON.parse(text).error?.details?.find(
      (detail) => detail.retryDelay,
    )?.retryDelay;
    const seconds = /^(\d+(?:\.\d+)?)s$/.exec(delay ?? "")?.[1];
    return seconds ? Math.ceil(Number(seconds)) : null;
  } catch {
    return null;
  }
}

async function notice() {
  // GitHub API 오류도 공지 초안 실패로만 남긴다. 이 job이 실패하면 run 전체가 실패로 보인다.
  try {
    const sha = env("RELEASED_SHA");
    const { version } = await releaseVersion(sha);
    // 체크리스트가 이미 있으면 publish가 다시 쓰지 않으므로 모델을 부르지 않는다.
    if (!process.env.DRY_RUN && (await findFollowUp(followUpTitle(version)))) {
      await output("status", "exists");
      return;
    }

    const { base, changes } = await releasedChanges(sha, version, {
      files: false,
    });
    await output("base", base ?? "");
    if (isEmpty(changes)) {
      await output("status", "none");
      return;
    }
    const input = noticeInput(changes);
    if (process.env.DRY_RUN) {
      console.log(input);
      if (!process.env.GEMINI_API_KEY) return;
    }

    const text = await generateNotice(input);
    if (process.env.DRY_RUN) console.log(text);
    if (isNothingToAnnounce(text)) {
      await output("status", "none");
    } else {
      await output("status", "ok");
      await output("text", text);
    }
  } catch (error) {
    // 공지 초안 때문에 태그와 체크리스트가 멈추지 않게 한다. publish가 직접 쓰라는 할 일을 남긴다.
    console.log(
      `::warning::Could not generate the release notice: ${error.message}`,
    );
    await output("status", "failed");
  }
}

// 태그, Release, 체크리스트 순서로 만들고, 각 단계는 이미 있으면 건너뛴다. 중간에 실패한 job을
// 다시 실행하면 빠진 단계만 채운다.
async function publish() {
  const sha = env("RELEASED_SHA");
  const { tagged, version } = await releaseVersion(sha);

  const { base, changes } = await releasedChanges(sha, version);
  let release = tagged ? await findRelease(version) : null;
  if (release) {
    console.log(`${version} already exists: ${release.html_url}`);
  } else {
    release = await api(`/repos/${REPO}/releases`, {
      method: "POST",
      body: {
        tag_name: version,
        target_commitish: sha,
        name: version,
        body: formatReleaseNotes({ changes }),
        make_latest: "true",
      },
    });
    console.log(`Released ${version}: ${release.html_url}`);
  }

  const followUp = formatFollowUpIssue({
    version,
    releaseUrl: release.html_url,
    changes,
    notice: noticeFrom(
      {
        status: process.env.NOTICE_STATUS,
        text: process.env.NOTICE_TEXT,
        base: process.env.NOTICE_BASE,
      },
      {
        base,
        logUrl: process.env.GITHUB_RUN_ID
          ? `${SERVER}/${REPO}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
      },
    ),
  });
  if (!followUp) return;
  const title = followUpTitle(version);
  const existing = await findFollowUp(title);
  if (existing) {
    console.log(`Follow-up already exists: ${existing.html_url}`);
    return;
  }
  await ensureLabel(
    FOLLOW_UP_LABEL,
    "FBCA04",
    "Checklist after a production release",
  );
  const issue = await api(`/repos/${REPO}/issues`, {
    method: "POST",
    body: { title, body: followUp, labels: [FOLLOW_UP_LABEL] },
  });
  console.log(`Follow-up: ${issue.html_url}`);
}

const commands = {
  dashboard,
  authorize,
  "release-pr": releasePr,
  notice,
  publish,
};
const command = commands[process.argv[2]];
if (!command) {
  throw new Error(`Usage: release.mjs ${Object.keys(commands).join("|")}`);
}
await command();
