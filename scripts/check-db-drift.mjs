/**
 * `supabase/schemas/`와 `supabase/migrations/`가 같은 스키마를 만드는지 검사한다.
 *
 * `supabase db schema declarative sync --no-apply`는 차이가 있어도 0으로 끝나고 차이를
 * 마이그레이션 파일로 써 둔다. 그래서 이 스크립트가 그 파일을 읽어 출력하고 지운 뒤 실패로
 * 돌려준다. 차이가 없으면 CLI가 파일을 쓰지 않는다.
 *
 * 로컬 DB는 건드리지 않는다. 비교는 CLI가 띄우는 shadow DB에서 한다.
 */
import { spawnSync } from "node:child_process";
import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrations = path.join(root, "supabase", "migrations");
const name = "drift_check";

const before = new Set(await readdir(migrations));
// 인자가 전부 상수라 셸 문자열 하나로 넘긴다. Windows에서 `npx`는 셸을 거쳐야 실행된다.
const result = spawnSync(
  `npx supabase db schema declarative sync --no-apply --name ${name}`,
  { cwd: root, encoding: "utf8", shell: true },
);
const created = (await readdir(migrations)).filter(
  (file) => !before.has(file) && file.endsWith(`_${name}.sql`),
);

if (result.status !== 0) {
  process.stderr.write(result.stdout + result.stderr);
  process.exit(result.status ?? 1);
}

if (created.length === 0) {
  console.log("  supabase/schemas와 migrations가 같은 스키마를 만듭니다.");
  process.exit(0);
}

for (const file of created) {
  const target = path.join(migrations, file);
  console.error(`supabase/schemas와 migrations가 어긋났습니다. 차이:\n`);
  console.error(await readFile(target, "utf8"));
  await rm(target);
}
console.error(
  "schemas를 먼저 고쳤다면 `npm run db:diff -- <name>`으로 마이그레이션을 만드세요.",
);
process.exit(1);
