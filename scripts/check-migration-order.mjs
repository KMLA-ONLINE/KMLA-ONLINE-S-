/**
 * PR이 바꾸는 migration을 base 브랜치와 비교한다. `.github/workflows/ci.yml`의 `migrations`
 * job이 PR merge commit의 첫 부모(base)와 merge commit을 넘긴다.
 *
 *   node scripts/check-migration-order.mjs <base-ref> [<head-ref>]
 *
 * base 브랜치의 migration은 이미 그 브랜치의 원격 DB(`dev` → dev, `main` → prod)에 배포된
 * 것으로 본다. 그래서 다음을 거부한다.
 *
 * - base의 가장 큰 버전보다 작거나 같은 새 migration. `db push`는 원격 history보다 앞선
 *   버전을 `--include-all` 없이 거부하고, 넣더라도 로컬과 다른 순서로 적용된다.
 * - base에 있는 migration의 수정, 삭제, 이름 변경.
 * - 이름이 `<14자리 버전>_<이름>.sql`이 아닌 새 파일과 버전이 겹치는 새 migration.
 */
import { execFileSync } from "node:child_process";

const DIRECTORY = "supabase/migrations";
const NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;

/** ref의 migration 파일 이름 → git object id. */
function migrations(ref) {
  const listing = execFileSync(
    "git",
    ["ls-tree", "-r", "-z", ref, "--", `${DIRECTORY}/`],
    { encoding: "utf8" },
  );
  const files = new Map();
  for (const entry of listing.split("\0")) {
    if (!entry) continue;
    const [meta, path] = entry.split("\t");
    files.set(path.slice(DIRECTORY.length + 1), meta.split(" ")[2]);
  }
  return files;
}

function version(name) {
  return NAME.exec(name)?.[1];
}

function problems(base, head) {
  const found = [];
  const report = (name, message) => found.push({ name, message });

  for (const [name, object] of base) {
    if (!head.has(name)) {
      report(
        name,
        "is already on the base branch and must not be removed or renamed.",
      );
    } else if (head.get(name) !== object) {
      report(name, "is already on the base branch and must not be edited.");
    }
  }

  const latest = [...base.keys()].map(version).filter(Boolean).sort().at(-1);
  const versions = new Map();
  for (const name of base.keys()) {
    if (head.has(name)) versions.set(version(name), name);
  }

  for (const name of [...head.keys()]
    .filter((name) => !base.has(name))
    .sort()) {
    const current = version(name);
    if (!current) {
      report(name, "must be named <14-digit version>_<snake_case_name>.sql.");
      continue;
    }
    if (latest && current <= latest) {
      report(
        name,
        `must sort after the base branch's latest migration ${latest}. Rebase and regenerate it with \`npm run db:diff\`.`,
      );
    }
    if (versions.has(current)) {
      report(name, `reuses version ${current} of ${versions.get(current)}.`);
    }
    versions.set(current, name);
  }
  return found;
}

const [baseRef, headRef = "HEAD"] = process.argv.slice(2);
if (!baseRef) {
  console.error(
    "Usage: node scripts/check-migration-order.mjs <base-ref> [<head-ref>]",
  );
  process.exitCode = 2;
} else {
  const found = problems(migrations(baseRef), migrations(headRef));
  for (const { name, message } of found) {
    const file = `${DIRECTORY}/${name}`;
    console.error(
      process.env.GITHUB_ACTIONS === "true"
        ? `::error file=${file}::${file} ${message}`
        : `${file} ${message}`,
    );
  }
  if (found.length > 0) process.exitCode = 1;
}
