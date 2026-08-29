/**
 * `npm run check`와 `npm run check:static`의 실행기.
 *
 * `react-router typegen`을 한 번만 돌린다. `lint`와 `typecheck`가 각각 부르던 자리라 매번
 * 5초를 두 번 쓰고 있었다. 뒤따르는 작업들은 생성된 타입을 읽기만 한다.
 *
 * 그다음 정적 검사 셋(eslint·prettier·tsc)을 동시에 띄우고, **테스트는 그것들이 끝난 뒤에
 * 혼자 돌린다.** 넷을 한꺼번에 돌려 봤더니 전체가 101초에서 171초로 늘었다. Vitest가 이미
 * threads 풀로 코어를 전부 쓰고 있어서, 옆에 무엇을 붙이든 서로 CPU를 빼앗고 테스트만
 * 59초에서 169초로 늘어진다. 정적 검사 셋은 서로 겹쳐도 그런 일이 없다.
 *
 * 병렬 실행이 치르는 대가는 뒤섞인 출력이다. 각 작업의 출력을 따로 모아 두었다가 실패한
 * 것만 끝에서 묶어 낸다. 대신 작업이 끝날 때마다 한 줄씩 즉시 찍어, 멈춘 건지 도는 건지는
 * 기다리는 동안에도 보이게 한다.
 */
import { spawn } from "node:child_process";

const staticOnly = process.argv.includes("--static");

// `npm run`을 거치는 것은 의도적이다. 각 명령의 실제 인자는 package.json 한 곳에만 두고,
// 여기서는 무엇을 언제 함께 돌릴지만 정한다.
const LINT = { name: "eslint", script: "lint:only" };
const TYPES = { name: "tsc", script: "typecheck:only" };
const FORMAT = { name: "prettier", script: "format:check" };
const TEST = { name: "vitest", script: "test" };

// `--static`은 편집 루프용이라 포맷 검사를 뺀다. 커밋할 때 lint-staged가 `prettier --write`로
// 이미 고쳐 주므로, 여기서 같은 것을 다시 물어봐야 손으로 할 일이 생기지 않는다.
const PARALLEL = staticOnly ? [LINT, TYPES] : [LINT, FORMAT, TYPES];

const width = Math.max(...[...PARALLEL, TEST].map((task) => task.name.length));

function seconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function report(name, ms, ok) {
  const mark = ok ? "✓" : "✗";
  console.error(`  ${mark} ${name.padEnd(width)}  ${seconds(ms).padStart(6)}`);
}

function run({ name, script }) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    // 인자를 배열로 넘기면서 `shell: true`를 쓰면 Node가 DEP0190을 띄운다. 스크립트
    // 이름은 이 파일 안의 상수뿐이라 한 줄로 합쳐 넘긴다.
    const child = spawn(`npm run --silent ${script}`, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";
    const collect = (chunk) => (output += chunk);
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

    child.on("close", (code) => {
      const ms = Date.now() - startedAt;
      const ok = code === 0;
      // 끝나는 즉시 찍는다. 전체가 끝나기를 기다렸다 몰아 내면 1분 넘게 빈 화면만 남는다.
      report(name, ms, ok);
      resolve({ name, output, ms, ok });
    });
  });
}

function dumpFailures(results) {
  for (const result of results) {
    if (result.ok) continue;

    const rule = "─".repeat(Math.max(0, 60 - result.name.length));
    console.error(`\n─── ${result.name} ${rule}`);
    process.stderr.write(`${result.output.trim()}\n`);
  }
}

const startedAt = Date.now();

console.error("▶ typegen");
const typegen = await run({ name: "typegen", script: "typegen" });
if (!typegen.ok) {
  dumpFailures([typegen]);
  console.error("\ntypegen이 실패해 나머지는 돌리지 않았습니다.");
  process.exit(1);
}

console.error(`▶ ${PARALLEL.map((task) => task.name).join(", ")}`);
const results = await Promise.all(PARALLEL.map(run));

if (!staticOnly) {
  console.error(`▶ ${TEST.name}`);
  results.push(await run(TEST));
}

dumpFailures(results);

const failed = results.filter((result) => !result.ok);
console.error(
  `\n  ${failed.length === 0 ? "통과" : `실패 ${failed.length}건: ${failed.map((result) => result.name).join(", ")}`} · 전체 ${seconds(Date.now() - startedAt)}`,
);

process.exit(failed.length === 0 ? 0 : 1);
