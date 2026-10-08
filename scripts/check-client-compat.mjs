// Fails when the database contract the deployed app relies on breaks without a
// client-compat bump.
//
// Production migrations land before the new app, and open apps keep running
// the old build until they reload. The contract they rely on is exactly the
// generated `database.types.ts`, so this compares that file at the base ref
// (what production runs, `origin/main` by default) with the working tree.
// When something the old build could use is gone or changed, the working tree
// must carry a higher `CLIENT_COMPAT_VERSION` than the base, which makes the
// database block the old build until it updates. Nobody judges "is this
// breaking" by hand; bumps are cheap, so every doubtful change counts.
//
// Anything the types cannot see — a function body that behaves differently,
// a tightened RLS policy — is not caught here. Bump by hand for those.
//
//   node scripts/check-client-compat.mjs [--base <ref>]
//
// The comparison itself lives in `client-compat.mjs`.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  findBreakingChanges,
  readSchemaVersion,
  readVersion,
  SCHEMA_PATH,
  TYPES_PATH,
  VERSION_PATH,
} from "./client-compat.mjs";

const baseArgIndex = process.argv.indexOf("--base");
const baseRef =
  baseArgIndex === -1 ? "origin/main" : process.argv[baseArgIndex + 1];

function gitShow(ref, path) {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function refExists(ref) {
  try {
    execFileSync(
      "git",
      ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
      {
        stdio: "ignore",
      },
    );
    return true;
  } catch {
    return false;
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────

function main() {
  const root = process.cwd();
  const headTypes = readFileSync(resolve(root, TYPES_PATH), "utf8");
  const headVersion = readVersion(
    readFileSync(resolve(root, VERSION_PATH), "utf8"),
  );
  const schemaVersion = readSchemaVersion(
    readFileSync(resolve(root, SCHEMA_PATH), "utf8"),
  );

  if (schemaVersion !== headVersion) {
    console.error(
      `[client-compat] ${SCHEMA_PATH}의 min_client_version()(${schemaVersion})과 ` +
        `${VERSION_PATH}의 CLIENT_COMPAT_VERSION(${headVersion})이 다릅니다.\n` +
        "  `npm run client-compat:bump`로 둘을 함께 올리세요.",
    );
    process.exit(1);
  }

  if (!refExists(baseRef)) {
    const message = `[client-compat] 기준 ${baseRef}을 찾을 수 없습니다. \`git fetch origin main\` 뒤 다시 실행하세요.`;
    // CI must compare against something; a local clone without the ref only
    // loses this one check, and CI still runs it.
    if (process.env.CI) {
      console.error(message);
      process.exit(1);
    }
    console.warn(`${message} 이번에는 건너뜁니다.`);
    return;
  }

  const baseTypes = gitShow(baseRef, TYPES_PATH);
  const baseVersion = readVersion(gitShow(baseRef, VERSION_PATH));

  if (headVersion < baseVersion) {
    console.error(
      `[client-compat] CLIENT_COMPAT_VERSION(${headVersion})이 ${baseRef}(${baseVersion})보다 낮습니다. 버전은 내려가지 않습니다.`,
    );
    process.exit(1);
  }

  const problems = baseTypes ? findBreakingChanges(baseTypes, headTypes) : [];
  if (problems.length === 0 || headVersion > baseVersion) {
    const note =
      problems.length > 0
        ? ` 호환이 깨지는 변경 ${problems.length}건, 버전 ${baseVersion} → ${headVersion}.`
        : "";
    console.log(`[client-compat] ${baseRef} 대비 통과.${note}`);
    return;
  }

  console.error(
    `[client-compat] ${baseRef}에 배포된 앱이 쓰는 DB 계약이 바뀌었는데 ` +
      `CLIENT_COMPAT_VERSION이 그대로입니다(${headVersion}).\n` +
      problems.map((problem) => `  - ${problem}`).join("\n") +
      "\n\n  `npm run client-compat:bump`를 실행하고, 생긴 마이그레이션을 함께 커밋하세요.",
  );
  process.exit(1);
}

main();
