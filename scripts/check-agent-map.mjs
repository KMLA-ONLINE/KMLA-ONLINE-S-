/**
 * `docs/AGENT_MAP.md`가 실제 코드와 어긋났는지 검사한다.
 *
 * 이 지도는 에이전트가 탐색 대신 읽는 좌표표라, 틀린 지도는 없는 지도보다 나쁘다. 그래서
 * 지도에서 가장 자주 낡는 표들을 사람 눈이 아니라 `npm run check`가 지킨다. 검사는 일곱 가지다.
 *
 *   1. 라우트 표의 `URL ↔ route module` 쌍이 `app/routes.ts`와 일치하는가
 *   2. 라우트 표의 Chrome 열이 그 모듈의 `defineAppChrome` 설정과 일치하는가
 *   3. 라우트 표의 Data 열(`L`/`A`/`S`)이 그 모듈의 실제 export와 일치하는가
 *   4. 라우트 표의 Test 열이 그 모듈을 import 하는 test 파일과 일치하는가
 *   5. feature 표의 이름이 `app/features/` 디렉터리와 일치하는가
 *   6. RPC·테이블 표가 `app/features/`의 `.rpc("...")`·`.from("...")` 호출 전부와 일치하는가
 *   7. 문서가 backtick으로 적은 저장소 경로가 전부 실제로 존재하는가
 *
 * 1번은 `app/routes.ts`를 파싱하지 않고 그대로 실행해서 얻는다. 이 파일이 쓰는 것은
 * `index`/`layout`/`route` 세 함수와 `satisfies RouteConfig`뿐이라, import와 타입 표기만
 * 걷어내면 그대로 JS다. 정규식으로 중첩을 흉내 내면 언젠가 부모를 잘못 읽지만, 이렇게 하면
 * React Router가 보는 것과 같은 트리를 본다.
 *
 * 6번은 RPC 이름이 선언된 schema 파일에 실제로 있는지까지 본다. 문서가 가리키는 곳과 정의된
 * 곳이 갈라지는 것이 이 표가 낡는 가장 흔한 방식이기 때문이다.
 *
 * `--print`는 검사 대신 세 표에 들어갈 행을 그대로 찍는다. 표를 갱신할 때 손으로 적지 않기
 * 위한 것이다.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAP_PATH = "docs/AGENT_MAP.md";
const ROUTES_PATH = "app/routes.ts";
const FEATURES_DIR = "app/features";
const SCHEMAS_DIR = "supabase/schemas";
const CHROME_PATH = "app/features/app-shell/model/chrome.ts";

/** 문서에서 표를 찾는 표지. prettier가 표의 폭을 바꿔도 이 줄은 그대로 남는다. */
const MARKERS = {
  routes: ["<!-- routes:begin -->", "<!-- routes:end -->"],
  features: ["<!-- features:begin -->", "<!-- features:end -->"],
  rpc: ["<!-- rpc:begin -->", "<!-- rpc:end -->"],
  tables: ["<!-- tables:begin -->", "<!-- tables:end -->"],
};

/**
 * 경로로 취급할 문자열의 뿌리. 여기에 없으면 심볼이나 URL로 보고 건너뛴다. 뒤의 두 항목은
 * RPC·테이블 표가 쓰는 축약형(`posts/data/mutations.ts`, `34-content-api.sql`)이다.
 */
const PATH_ROOTS = [
  "app/",
  "docs/",
  "supabase/",
  "test/",
  "e2e/",
  "scripts/",
  "public/",
  "eslint-rules/",
  ".agents/",
  ".github/",
];
const SHORTHAND = [
  [/^[a-z-]+\/data\/[a-z-]+\.ts$/, `${FEATURES_DIR}/`],
  [/^\d\d-[a-z-]+\.sql$/, `${SCHEMAS_DIR}/`],
];

async function walk(dir, match, found = []) {
  for (const entry of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    const next = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await walk(next, match, found);
    else if (match.test(entry.name)) found.push(next);
  }
  return found;
}

async function readRouteTree() {
  const source = await readFile(path.join(root, ROUTES_PATH), "utf8");
  const body = source
    // import은 몇 줄로 나뉘든 전부 걷어낸다. 한 문장만 노리면 `import type { RouteConfig }`가
    // 따로 떨어지는 순간 SyntaxError로 죽는다.
    .replace(/^import[\s\S]*?;$/gm, "")
    .replace(/\s+satisfies\s+RouteConfig/, "")
    .replace(/export default/, "return");

  const node =
    (kind) =>
    (...args) => {
      const [first, second, third] = args;
      return kind === "route"
        ? { kind, urlPath: first, file: second, children: third ?? [] }
        : { kind, file: first, children: second ?? [] };
    };

  // 이 파일이 `index`/`layout`/`route` 밖의 헬퍼(`prefix` 등)를 쓰기 시작하면 여기서 죽는다.
  // 그때 스택 트레이스를 뱉으면 `npm run check`가 통째로 막히고 원인이 안 보이므로, 무엇을
  // 어떻게 고치면 되는지만 남기고 끝낸다.
  try {
    const build = new Function("index", "layout", "route", body);
    return build(node("index"), node("layout"), node("route"));
  } catch (error) {
    console.error(
      `${ROUTES_PATH}를 읽지 못했습니다 — ${error.message}\n` +
        `이 검사는 \`index\`/\`layout\`/\`route\`만 압니다. 새 헬퍼를 쓴다면\n` +
        `${import.meta.filename}의 readRouteTree를 함께 고쳐 주세요.`,
    );
    process.exit(1);
  }
}

/** 트리를 `URL → route module` 평면 목록으로 편다. layout은 URL 세그먼트를 더하지 않는다. */
function flatten(nodes, parentUrl = "") {
  const rows = [];

  for (const node of nodes) {
    let url;
    if (node.kind === "layout") url = "(layout)";
    else if (node.kind === "index") url = parentUrl === "" ? "/" : parentUrl;
    else url = `${parentUrl}/${node.urlPath}`;

    rows.push({ url, file: `app/${node.file}` });
    // `route(path, file, options, children)` 4인자 형태를 쓰면 세 번째 인자가 options
    // 객체다. 배열이 아니면 자식이 없는 것으로 보고 넘어간다 — 객체를 순회하려다 죽는 것보다
    // 그 줄만 비어 보이는 편이 낫고, 그 경우 라우트 표 비교가 차이를 짚어 준다.
    if (Array.isArray(node.children)) {
      rows.push(
        ...flatten(node.children, node.kind === "route" ? url : parentUrl),
      );
    }
  }

  return rows;
}

/**
 * `app/features/**`에서 `.rpc("name")`과 `.from("name")`을 모은다. 두 호출 모두 feature의
 * `data/`에서만 일어나야 하므로, 다른 곳에서 나오면 그 자체가 보고할 값이다.
 */
async function collectSupabaseCalls() {
  const files = await walk(FEATURES_DIR, /\.tsx?$/);
  const calls = { rpc: new Map(), from: new Map() };

  for (const file of files) {
    const text = await readFile(path.join(root, file), "utf8");
    const short = file.slice(`${FEATURES_DIR}/`.length);

    for (const [kind, pattern] of [
      ["rpc", /\.rpc\(\s*"([a-z0-9_]+)"/g],
      ["from", /\.from\(\s*"([a-z0-9_]+)"/g],
    ]) {
      for (const [, name] of text.matchAll(pattern)) {
        if (!calls[kind].has(name)) calls[kind].set(name, new Set());
        calls[kind].get(name).add(short);
      }
    }
  }

  return calls;
}

/** RPC 이름을 정의한 schema 파일을 찾는다. 없으면 `null`. */
async function locateFunctions(names) {
  const files = (await readdir(path.join(root, SCHEMAS_DIR))).filter((file) =>
    file.endsWith(".sql"),
  );
  const sources = [];
  for (const file of files) {
    sources.push([
      file,
      await readFile(path.join(root, SCHEMAS_DIR, file), "utf8"),
    ]);
  }

  const located = new Map();
  for (const name of names) {
    const pattern = new RegExp(
      String.raw`FUNCTION\s+"?public"?\."?${name}"?\s*\(`,
      "i",
    );
    const hit = sources.find(([, text]) => pattern.test(text));
    located.set(name, hit ? hit[0] : null);
  }
  return located;
}

function tableRows(markdown, kind) {
  const [begin, end] = MARKERS[kind];
  const from = markdown.indexOf(begin);
  const to = markdown.indexOf(end);
  if (from === -1 || to === -1) {
    throw new Error(`${MAP_PATH}에 ${begin} / ${end} 표지가 없습니다.`);
  }

  return markdown
    .slice(from + begin.length, to)
    .split("\n")
    .filter((line) => line.trim().startsWith("|"))
    .map((line) =>
      line
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim()),
    )
    .filter(([first]) => !/^-+$/.test(first) && !/^[A-Z]/.test(first))
    .map((cells) => cells.map((cell) => cell.replace(/`/g, "")));
}

/**
 * 라우트 표의 Chrome 열을 `defineAppChrome` 설정에서 다시 뽑는다. 형식은 문서와 같은
 * `header/bottomNav/contentWidth`이고 `pullToRefresh`가 켜져 있으면 `/PTR`이 붙는다.
 *
 * 생략된 `contentWidth`는 `DEFAULT_APP_CHROME`이 채우므로, 기본값을 여기 적어 두지 않고
 * `chrome.ts`에서 읽는다. 기본이 바뀌면 지도도 같이 틀려야 한다.
 */
async function routeChrome(file, fallbackWidth) {
  const source = await readFile(path.join(root, file), "utf8").catch(
    () => null,
  );
  if (source === null) return null;

  const declaration = source.match(
    /export\s+const\s+handle\s*=\s*defineAppChrome\(\{([\s\S]*?)\}\)/,
  );
  if (!declaration) return "—";

  const body = declaration[1];
  const field = (name) =>
    body.match(new RegExp(String.raw`\b${name}\s*:\s*"([a-z0-9-]+)"`))?.[1] ??
    null;

  const header = field("header");
  const bottomNav = field("bottomNav");
  // 두 값은 타입이 필수로 요구하므로, 못 읽었다면 이 정규식이 낡은 것이다.
  if (!header || !bottomNav) return "???";

  const width = field("contentWidth") ?? fallbackWidth;
  const ptr = /\bpullToRefresh\s*:\s*true\b/.test(body);

  return `${header}/${bottomNav}/${width}${ptr ? "/PTR" : ""}`;
}

/** `DEFAULT_APP_CHROME`의 `contentWidth`. Chrome 열의 생략된 폭이 이 값으로 풀린다. */
async function defaultContentWidth() {
  const source = await readFile(path.join(root, CHROME_PATH), "utf8");
  const width = source
    .match(/DEFAULT_APP_CHROME[^{]*\{([\s\S]*?)\}/)?.[1]
    ?.match(/\bcontentWidth\s*:\s*"([a-z0-9]+)"/)?.[1];

  if (!width) {
    console.error(
      `${CHROME_PATH}에서 DEFAULT_APP_CHROME.contentWidth를 읽지 못했습니다.`,
    );
    process.exit(1);
  }
  return width;
}

/**
 * 라우트 표의 Data 열(`L`/`A`/`S`)을 export 기준으로 다시 뽑는다.
 *
 * 이름이 본문 어딘가에 나오는지로 세면 안 된다. `posts/new` 라우트들은 부모의
 * `clientLoader`를 타입으로만 import하는데, 그걸 loader가 있는 것으로 적어 두면 없는 함수를
 * 찾으러 가게 된다.
 */
async function routeDataFlags(file) {
  const source = await readFile(path.join(root, file), "utf8").catch(
    () => null,
  );
  if (source === null) return null;

  const exported = (name) =>
    new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${name}\\b`).test(
      source,
    );

  return (
    [
      exported("clientLoader") && "L",
      exported("clientAction") && "A",
      exported("shouldRevalidate") && "S",
    ]
      .filter(Boolean)
      .join(" ") || "—"
  );
}

/**
 * 라우트 표의 Test 열을 다시 뽑는다. 정의는 "이 route 모듈을 import 하는 test 파일"이다.
 *
 * 눈으로 채우면 틀린다. 처음 채웠을 때 `/pending`과 `/admin`에는 없는 커버리지가 적혔고
 * `/blocked`는 있는 커버리지가 빠졌다. 없는 테스트를 가리키는 쪽이 특히 나쁘다 — 거기
 * 케이스를 추가하려고 파일을 열었다가 그 route가 아예 없는 걸 그제야 알게 된다.
 *
 * feature 단위 테스트(`test/features/<feature>/`)는 feature 표가 이미 가리키므로 여기서는
 * 세지 않는다.
 */
async function routeTests(file, testFiles) {
  const spec = file.replace(/^app\//, "~/").replace(/\.tsx?$/, "");
  const variants = [spec];
  if (spec.endsWith("/index")) variants.push(spec.slice(0, -"/index".length));

  const hits = [];
  for (const [testPath, source] of testFiles) {
    const matched = variants.some((variant) =>
      new RegExp(
        `from\\s+"${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`,
      ).test(source),
    );
    if (matched) hits.push(testPath);
  }
  return hits.length > 0 ? hits.join(", ") : "—";
}

function diff(expected, actual, label, errors) {
  for (const value of expected) {
    if (!actual.includes(value))
      errors.push(`${label}: 문서에 없습니다 — ${value}`);
  }
  for (const value of actual) {
    if (!expected.includes(value))
      errors.push(`${label}: 코드에 없는 행입니다 — ${value}`);
  }
}

async function checkPaths(markdown, errors) {
  const tokens = new Set(
    Array.from(markdown.matchAll(/`([^`\n]+)`/g), (match) => match[1]),
  );

  // glob(`*`), 자리표시자(`<feature>`), 문장은 경로가 아니다.
  for (const token of tokens) {
    if (/[*<>\s]/.test(token)) continue;
    const trimmed = token.replace(/\/+$/, "");

    let candidate = null;
    if (PATH_ROOTS.some((prefix) => trimmed.startsWith(prefix))) {
      candidate = trimmed;
    } else {
      const shorthand = SHORTHAND.find(([pattern]) => pattern.test(trimmed));
      if (shorthand) candidate = `${shorthand[1]}${trimmed}`;
    }
    if (!candidate) continue;

    try {
      await stat(path.join(root, candidate));
    } catch {
      errors.push(`경로: 존재하지 않습니다 — ${candidate}`);
    }
  }
}

const sorted = (set) => Array.from(set).sort().join(", ");

const routes = flatten(await readRouteTree());
const calls = await collectSupabaseCalls();
const definedIn = await locateFunctions(calls.rpc.keys());

const rpcExpected = Array.from(calls.rpc.keys())
  .sort()
  .map(
    (name) =>
      `${name} | ${sorted(calls.rpc.get(name))} | ${definedIn.get(name) ?? "???"}`,
  );
const tableExpected = Array.from(calls.from.keys())
  .sort()
  .map((name) => `${name} | ${sorted(calls.from.get(name))}`);

if (process.argv.includes("--print")) {
  console.log("### routes");
  for (const { url, file } of routes)
    console.log(`| \`${url}\` | \`${file}\` |`);
  console.log("\n### rpc");
  for (const row of rpcExpected) {
    console.log(
      `| ${row
        .split(" | ")
        .map((cell) => `\`${cell}\``)
        .join(" | ")} |`,
    );
  }
  console.log("\n### tables");
  for (const row of tableExpected) {
    console.log(
      `| ${row
        .split(" | ")
        .map((cell) => `\`${cell}\``)
        .join(" | ")} |`,
    );
  }
  process.exit(0);
}

const markdown = await readFile(path.join(root, MAP_PATH), "utf8");
const features = (
  await readdir(path.join(root, FEATURES_DIR), { withFileTypes: true })
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const errors = [];

for (const [name, file] of definedIn) {
  if (!file) errors.push(`RPC: schema에 정의가 없습니다 — ${name}`);
}

diff(
  routes.map(({ url, file }) => `${url} → ${file}`),
  tableRows(markdown, "routes").map(([url, file]) => `${url} → ${file}`),
  "라우트",
  errors,
);
const testFiles = [];
for (const file of await walk("test", /\.tsx?$/)) {
  testFiles.push([file, await readFile(path.join(root, file), "utf8")]);
}

const contentWidth = await defaultContentWidth();

for (const cells of tableRows(markdown, "routes")) {
  const [url, file, documentedChrome, documentedData, , , documentedTest] =
    cells;

  const chrome = await routeChrome(file, contentWidth);
  if (chrome !== null && chrome !== documentedChrome) {
    errors.push(
      `Chrome 열: ${url} — 문서 "${documentedChrome}", 실제 "${chrome}" (${file})`,
    );
  }

  const data = await routeDataFlags(file);
  if (data !== null && data !== documentedData) {
    errors.push(
      `Data 열: ${url} — 문서 "${documentedData}", 실제 "${data}" (${file})`,
    );
  }

  const test = await routeTests(file, testFiles);
  if (test !== documentedTest) {
    errors.push(`Test 열: ${url} — 문서 "${documentedTest}", 실제 "${test}"`);
  }
}

diff(
  features,
  tableRows(markdown, "features").map(([name]) => name),
  "feature",
  errors,
);
diff(
  rpcExpected,
  tableRows(markdown, "rpc").map((cells) => cells.slice(0, 3).join(" | ")),
  "RPC",
  errors,
);
diff(
  tableExpected,
  tableRows(markdown, "tables").map((cells) => cells.slice(0, 2).join(" | ")),
  "테이블",
  errors,
);
await checkPaths(markdown, errors);

if (errors.length > 0) {
  console.error(`${MAP_PATH}가 코드와 어긋났습니다.\n`);
  for (const error of errors) console.error(`  ✗ ${error}`);
  console.error(
    "\n표는 `node scripts/check-agent-map.mjs --print`로 다시 뽑을 수 있습니다.",
  );
  process.exit(1);
}

console.error(
  `  ${MAP_PATH}: 라우트 ${routes.length} · feature ${features.length} · RPC ${rpcExpected.length} · 테이블 ${tableExpected.length} 일치`,
);
