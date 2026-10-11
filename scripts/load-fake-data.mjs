// 로컬 Supabase DB에 대량 가짜 데이터(supabase/dev/fake-data.sql)를 넣는다. 로딩 화면 확인용.
// 원격 프로젝트에는 닿지 않는다. 로컬 DB 컨테이너에 직접 psql을 연다.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const config = readFileSync("supabase/config.toml", "utf8");
const projectId = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
if (!projectId) {
  console.error("supabase/config.toml에서 project_id를 찾지 못했습니다.");
  process.exit(1);
}

const result = spawnSync(
  "docker",
  [
    "exec",
    "-i",
    `supabase_db_${projectId}`,
    "psql",
    "-v",
    "ON_ERROR_STOP=1",
    "-U",
    "postgres",
    "-q",
  ],
  {
    input: readFileSync("supabase/dev/fake-data.sql"),
    stdio: ["pipe", "inherit", "inherit"],
  },
);

if (result.error) {
  console.error(
    "docker를 실행하지 못했습니다. `npm run db:start`로 로컬 DB를 먼저 띄우세요.",
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
