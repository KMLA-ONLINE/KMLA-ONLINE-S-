/**
 * Production 릴리스가 Vercel에 대해 하는 두 단계. `.github/workflows/release.yml`이 부른다.
 *
 *   node scripts/release/vercel.mjs preflight
 *     토큰이 가리키는 프로젝트가 이 저장소의 `main` 배포 대상인지 확인한다. DB 마이그레이션보다
 *     먼저 돌아서, 잘못된 프로젝트·토큰이면 prod DB를 건드리기 전에 멈춘다. 프로젝트 이름을
 *     `name` 출력으로 남긴다.
 *
 *   node scripts/release/vercel.mjs deploy
 *     `GITHUB_SHA`를 production으로 배포하고 끝날 때까지 기다린다. 배포된 것이 정말 그
 *     프로젝트·target·커밋인지 다시 확인한 뒤 URL을 `url` 출력으로 남긴다.
 *
 * `vercel.json`이 `main`의 Git 자동 배포를 꺼 두었기 때문에, prod 배포는 승인된 이 job에서만
 * 일어난다.
 */
import { appendFile } from "node:fs/promises";

const API = "https://api.vercel.com";
const POLL_INTERVAL_MS = 10_000;
const POLL_ATTEMPTS = 120;

function env(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment value: ${name}`);
  return value;
}

async function vercel(pathname, { method = "GET", query = {}, body } = {}) {
  const url = new URL(pathname, API);
  url.searchParams.set("teamId", env("VERCEL_ORG_ID"));
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${env("VERCEL_TOKEN")}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `Vercel ${method} ${url.pathname} failed with ${response.status}: ${text}`,
    );
  }
  return JSON.parse(text);
}

async function output(key, value) {
  await appendFile(env("GITHUB_OUTPUT"), `${key}=${value}\n`);
}

function repository() {
  const [owner, name] = env("GITHUB_REPOSITORY").split("/");
  return { owner, name };
}

async function preflight() {
  const projectId = env("VERCEL_PROJECT_ID");
  const { owner, name } = repository();
  const project = await vercel(`/v9/projects/${projectId}`);

  if (project.id !== projectId) {
    throw new Error(`Vercel returned unexpected project ${project.id}.`);
  }
  const link = project.link ?? {};
  if (
    project.accountId !== env("VERCEL_ORG_ID") ||
    link.type !== "github" ||
    link.org !== owner ||
    link.repo !== name ||
    link.productionBranch !== "main"
  ) {
    throw new Error(
      `Vercel project is not the main deployment for ${owner}/${name}.`,
    );
  }
  if (!project.name) throw new Error("Vercel project has no name.");

  await output("name", project.name);
}

async function deploy() {
  const projectId = env("VERCEL_PROJECT_ID");
  const sha = env("GITHUB_SHA");
  const { owner, name } = repository();

  const created = await vercel("/v13/deployments", {
    method: "POST",
    query: { skipAutoDetectionConfirmation: "1", forceNew: "1" },
    body: {
      name: env("VERCEL_PROJECT_NAME"),
      project: projectId,
      target: "production",
      gitSource: { type: "github", org: owner, repo: name, ref: "main", sha },
    },
  });
  if (!created.id) throw new Error("Vercel did not return a deployment id.");

  for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
    const deployment = await vercel(`/v13/deployments/${created.id}`, {
      query: { withGitRepoInfo: "true" },
    });

    switch (deployment.readyState) {
      case "READY": {
        if (
          deployment.projectId !== projectId ||
          deployment.target !== "production" ||
          deployment.gitSource?.sha !== sha
        ) {
          throw new Error(
            "Vercel deployed an unexpected project, target, or commit.",
          );
        }
        const url = `https://${deployment.url}`;
        await output("url", url);
        await appendFile(
          env("GITHUB_STEP_SUMMARY"),
          `Production deployment: ${url}\n`,
        );
        return;
      }
      case "ERROR":
      case "CANCELED":
      case "BLOCKED":
        throw new Error(
          `${deployment.errorCode ?? "VERCEL_DEPLOYMENT_FAILED"}: ${deployment.errorMessage ?? deployment.readyState}`,
        );
      case undefined:
        throw new Error("Vercel deployment has no readyState.");
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`Timed out waiting for Vercel deployment ${created.id}.`);
}

const commands = { preflight, deploy };
const command = commands[process.argv[2]];
if (!command) {
  console.error("Usage: node scripts/release/vercel.mjs <preflight|deploy>");
  process.exitCode = 2;
} else {
  try {
    await command();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
