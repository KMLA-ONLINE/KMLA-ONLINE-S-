/**
 * PR이 바꾼 경로 중 원격 Supabase에 배포되는 것을 고른다. `.github/workflows/preview.yml`이
 * 경로를 한 줄에 하나씩 표준 입력으로 넘긴다.
 *
 * 원격 DB와 Edge Function은 `dev`에 merge된 뒤에야 dev 프로젝트에 배포된다. 그 전의 Preview는
 * 옛 schema·함수에 붙어 틀린 화면을 보여 주므로, 이런 PR은 Preview 대신 로컬에서 리뷰한다.
 * `seed.sql`과 pgTAP은 원격에 배포되지 않으므로 고르지 않는다. `config.toml`은 Edge Function
 * 배포 설정을 담으므로 고른다.
 *
 * GITHUB_OUTPUT에 `changed`(true/false)와 `paths`(여러 줄)를 남긴다.
 */
import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";
import { text } from "node:stream/consumers";

const REMOTE = [
  /^supabase\/migrations\//,
  /^supabase\/schemas\//,
  /^supabase\/functions\//,
  /^supabase\/config\.toml$/,
];

const paths = [
  ...new Set(
    (await text(process.stdin))
      .split("\n")
      .map((line) => line.trim())
      .filter((path) => REMOTE.some((pattern) => pattern.test(path))),
  ),
];

for (const path of paths) console.log(path);

if (process.env.GITHUB_OUTPUT) {
  const delimiter = `PATHS_${randomUUID()}`;
  await appendFile(
    process.env.GITHUB_OUTPUT,
    `changed=${paths.length > 0}\npaths<<${delimiter}\n${paths.map((path) => `${path}\n`).join("")}${delimiter}\n`,
  );
}
