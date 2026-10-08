// Raises the minimum client version by one, in both places that carry it, and
// drafts the migration for it. `check-client-compat.mjs` asks for this whenever
// the database contract breaks for the deployed app.
//
// A branch bumps at most once per release: when it is already above the base
// (`origin/main`), there is nothing to do, however many more breaking changes
// it adds.
//
//   npm run client-compat:bump

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  MIN_CLIENT_VERSION_BODY,
  readVersion,
  SCHEMA_PATH,
  VERSION_PATH,
} from "./client-compat.mjs";

const root = process.cwd();
const versionFile = resolve(root, VERSION_PATH);
const schemaFile = resolve(root, SCHEMA_PATH);

const current = readVersion(readFileSync(versionFile, "utf8"));
let base = 0;
try {
  base = readVersion(
    execFileSync("git", ["show", `origin/main:${VERSION_PATH}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
} catch {
  // origin/main predates the version file, or is not fetched. Bump from here.
}

if (current > base) {
  console.log(
    `[client-compat] 이 브랜치는 이미 ${base} → ${current}로 올렸습니다. 할 일이 없습니다.`,
  );
  process.exit(0);
}

const next = Math.max(current, base) + 1;

writeFileSync(
  versionFile,
  readFileSync(versionFile, "utf8").replace(
    /CLIENT_COMPAT_VERSION\s*=\s*\d+/,
    `CLIENT_COMPAT_VERSION = ${next}`,
  ),
);

const schema = readFileSync(schemaFile, "utf8");
if (!MIN_CLIENT_VERSION_BODY.test(schema)) {
  console.error(
    `[client-compat] ${SCHEMA_PATH}에서 min_client_version()을 찾지 못했습니다.`,
  );
  process.exit(1);
}
writeFileSync(
  schemaFile,
  schema.replace(MIN_CLIENT_VERSION_BODY, `$1${next}$3`),
);

console.log(
  `[client-compat] ${current} → ${next}. 마이그레이션 초안을 만듭니다.`,
);
const diff = spawnSync(`npm run db:diff -- client_compat_v${next}`, {
  shell: true,
  stdio: "inherit",
});
if (diff.status !== 0) {
  console.error(
    "[client-compat] 초안을 만들지 못했습니다. 로컬 Supabase를 켜고 " +
      `\`npm run db:diff -- client_compat_v${next}\`를 실행하세요.`,
  );
  process.exit(1);
}
console.log(
  "[client-compat] 생긴 마이그레이션을 읽어 보고 `npx supabase migration up --local`로 적용한 뒤 함께 커밋하세요.",
);
