/**
 * `.github/workflows/release-dashboard.yml`이 부르는 릴리즈 정리 단계. 본문은 `plan.mjs`가 만들고,
 * 여기서는 GitHub API만 부른다. `GITHUB_TOKEN`과 `GITHUB_REPOSITORY`가 필요하다.
 *
 *   node scripts/release/release.mjs dashboard
 *     마지막 릴리즈 태그...`dev`의 변경으로 릴리즈 대기 목록 이슈를 갱신하고, 없으면 만든다. 그중
 *     `main`에 이미 있는 것은 prod 배포 대기로 따로 보인다. 이 workflow가 만든
 *     릴리즈 PR이 열려 있으면 그 본문도 다시 쓴다. `DRY_RUN=1`이면 쓰지 않고 본문만 출력한다.
 *
 *   node scripts/release/release.mjs authorize
 *     `COMMENTER`가 저장소 admin인지, `COMMENT_BODY`가 `/release`인지 확인하고
 *     `allowed` 출력을 남긴다.
 *
 *   node scripts/release/release.mjs release-pr
 *     `dev` head의 배포가 성공했으면 `dev` → `main` PR을 만들거나 갱신하고 `ISSUE`에 결과를
 *     댓글로 남긴다. PR은 `RELEASE_PR_TOKEN`(GitHub App)으로 만든다. `GITHUB_TOKEN`이 만든 PR에는
 *     `pull_request` workflow가 돌지 않아 CI가 빠지기 때문이다.
 *
 *   node scripts/release/release.mjs publish
 *     `release.yml`이 `RELEASED_SHA`를 prod에 배포한 뒤, 그 커밋에 CalVer 태그와 GitHub Release를
 *     만들고 릴리즈 후 할 일이 있으면 체크리스트 이슈를 연다. 이미 태그가 있으면 건너뛴다.
 */
import { appendFile } from "node:fs/promises";

import {
  canRelease,
  nextVersion,
  formatDashboard,
  formatFollowUpIssue,
  formatReleaseNotes,
  formatReleasePr,
} from "./plan.mjs";

const API = process.env.GITHUB_API_URL ?? "https://api.github.com";
const SERVER = process.env.GITHUB_SERVER_URL ?? "https://github.com";
const DASHBOARD_LABEL = "release-dashboard";
const DASHBOARD_TITLE = "릴리즈 대기 목록";
const DASHBOARD_MARKER = "<!-- release-dashboard -->";
const RELEASE_PR_MARKER = "<!-- release-pr -->";
const RELEASE_PR_TITLE = "Release dev to main";
const FOLLOW_UP_LABEL = "release-follow-up";

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
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}

// ── 변경 목록 ────────────────────────────────────────────────────────────────

/** 커밋마다 `dev`에 merge된 PR을 찾는다. `dev`는 squash merge라서 커밋 하나가 PR 하나다. */
async function changesFrom(commits, onMain = () => false) {
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
    const files = await paginate(
      `/repos/${REPO}/pulls/${pr.number}/files?per_page=100`,
    );
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
 * prod에 없는 `dev` 변경. `main...dev`만 보면 merge 뒤 배포가 거부되거나 실패한 변경이 목록에서
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

/** 대기 목록과 릴리즈 PR에 필요한 상태를 한 번에 읽는다. */
async function snapshot() {
  const [lastRelease, head, pr] = await Promise.all([
    latestRelease(),
    devHead(),
    openReleasePr(),
  ]);
  const [changes, deploy] = await Promise.all([
    pendingChanges(lastRelease),
    devDeploy(head.sha),
  ]);
  return { changes, head, deploy, pr, lastRelease };
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
  const { changes, head, deploy, pr, lastRelease } = await snapshot();
  const body = formatDashboard({
    changes,
    head,
    deploy,
    releasePr: pr?.number ?? null,
    lastRelease,
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
  const { changes, head, deploy, pr: existing } = await snapshot();
  const commit = `\`${head.sha.slice(0, 7)}\``;
  const merged = [...changes.prs, ...changes.commits].filter(
    (change) => change.onMain,
  ).length;
  const all = changes.prs.length + changes.commits.length;

  if (all === merged) {
    await comment(
      issue,
      merged > 0
        ? `\`main\`에 없는 \`dev\` 변경이 없어 릴리즈 PR을 만들지 않았습니다. \`main\`에 merge됐지만 배포되지 않은 변경 ${merged}개는 \`release.yml\`을 다시 실행해 내보냅니다.`
        : "prod에 릴리즈할 `dev` 변경이 없습니다.",
    );
  } else if (deploy?.conclusion !== "success") {
    await comment(
      issue,
      `\`dev\` head ${commit}의 배포가 아직 성공하지 않아 릴리즈 PR을 만들지 않았습니다${deploy ? ` ([실행 기록](${deploy.url}))` : ""}. 배포가 끝난 뒤 다시 \`/release\`를 남겨 주세요.`,
    );
  } else if (existing && !existing.body?.startsWith(RELEASE_PR_MARKER)) {
    await comment(
      issue,
      `이미 열린 \`dev\` → \`main\` PR #${existing.number}이 있습니다. 직접 만든 PR이라 본문은 바꾸지 않았습니다.`,
    );
  } else {
    const body = formatReleasePr({ changes, head, deploy });
    let number;
    if (existing) {
      number = existing.number;
      await api(`/repos/${REPO}/pulls/${number}`, {
        method: "PATCH",
        body: { body },
      });
    } else {
      const created = await api(`/repos/${REPO}/pulls`, {
        method: "POST",
        token: env("RELEASE_PR_TOKEN"),
        body: { title: RELEASE_PR_TITLE, head: "dev", base: "main", body },
      });
      number = created.number;
    }
    await comment(
      issue,
      `${existing ? "릴리즈 PR을 갱신했습니다" : "릴리즈 PR을 만들었습니다"}: #${number} (\`dev\` ${commit}). merge하면 CI 뒤 \`Production\` 승인을 기다립니다.`,
    );
  }

  await dashboard();
}

// ── 릴리즈 후 ────────────────────────────────────────────────────────────────

/**
 * 이번 배포로 prod에 처음 나간 변경. 직전 릴리즈 태그와 비교하므로 배포가 실패했던 이전 릴리즈 PR의
 * 변경도 함께 들어간다. 첫 릴리즈는 비교할 태그가 없어 그 커밋을 merge한 릴리즈 PR의 커밋을 쓴다.
 */
async function releasedChanges(sha) {
  const lastRelease = await latestRelease();
  if (lastRelease) {
    return changesFrom(await compareCommits(lastRelease.tag, sha));
  }

  const pulls = await api(`/repos/${REPO}/commits/${sha}/pulls`);
  const pr = pulls.find((pull) => pull.base.ref === "main" && pull.merged_at);
  if (!pr) return { prs: [], commits: [] };
  return changesFrom(
    await paginate(`/repos/${REPO}/pulls/${pr.number}/commits?per_page=100`),
  );
}

async function publish() {
  const sha = env("RELEASED_SHA");
  const tags = await paginate(`/repos/${REPO}/tags?per_page=100`);
  const existing = tags.find((tag) => tag.commit.sha === sha);
  if (existing) {
    console.log(`${sha} is already tagged ${existing.name}; skipping.`);
    await dashboard();
    return;
  }

  const changes = await releasedChanges(sha);
  const version = nextVersion(
    new Date(),
    tags.map((tag) => tag.name),
  );
  const release = await api(`/repos/${REPO}/releases`, {
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

  const followUp = formatFollowUpIssue({
    version,
    releaseUrl: release.html_url,
    changes,
  });
  if (followUp) {
    await ensureLabel(
      FOLLOW_UP_LABEL,
      "FBCA04",
      "Checklist after a production release",
    );
    const issue = await api(`/repos/${REPO}/issues`, {
      method: "POST",
      body: {
        title: `${version} 릴리즈 후 할 일`,
        body: followUp,
        labels: [FOLLOW_UP_LABEL],
      },
    });
    console.log(`Follow-up: ${issue.html_url}`);
  }

  await dashboard();
}

const commands = { dashboard, authorize, "release-pr": releasePr, publish };
const command = commands[process.argv[2]];
if (!command) {
  throw new Error(`Usage: release.mjs ${Object.keys(commands).join("|")}`);
}
await command();
