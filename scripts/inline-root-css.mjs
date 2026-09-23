// Inlines the build's single render-blocking stylesheet into index.html.
//
// Runs between `react-router build` and `scripts/build-sw.mjs`, for the same
// reason the service worker does: index.html comes out of React Router's
// prerender pass, which finishes after every plugin's `closeBundle` hook, so no
// build-time plugin ever sees it. It has to run *before* build-sw.mjs so the
// precache manifest covers the rewritten file.
//
// Deferring the stylesheet instead is not an option here. `build/client/index.html`
// carries a prerendered app shell, so the stylesheet is genuinely on the critical
// path — making it async would trade the round trip for an unstyled flash.
// Inlining removes the request instead of moving it.

import { readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const clientDir = resolve(process.cwd(), "build/client");
const indexHtml = resolve(clientDir, "index.html");
const assetsDir = join(clientDir, "assets");

function fail(message) {
  console.error(`[css] ${message}`);
  process.exit(1);
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    // `.vite/manifest.json`은 빌드 산출물 장부라 지운 파일을 계속 적어 두는 게 맞다.
    // 배포되는 파일도 아니고(서비스 워커 glob에서도 제외된다) 런타임이 읽지도 않는다.
    if (entry.isDirectory()) {
      if (entry.name !== ".vite") yield* walk(path);
    } else {
      yield path;
    }
  }
}

const html = readFileSync(indexHtml, "utf8");

// Vite가 prerender된 head 끝에 넣는 태그 하나를 노린다. 여러 개가 나온다면 라우트별
// CSS가 생겼다는 뜻이고, 그때는 무엇을 인라인할지 다시 정해야 한다.
const links = [
  ...html.matchAll(
    /<link rel="stylesheet" href="(\/assets\/[^"]+\.css)"\s*\/?>/g,
  ),
];

if (links.length !== 1) {
  fail(
    `expected exactly one <link rel="stylesheet"> in index.html, found ${links.length}. ` +
      "The build output changed shape; re-check what belongs on the critical path.",
  );
}

const [tag, href] = links[0];
const cssFile = resolve(clientDir, href.slice(1));
const css = readFileSync(cssFile, "utf8");

// 인라인한 뒤로는 HTML 파서가 이 문자열을 읽는다. `</style`이나 `<!--`가 들어 있으면
// 스타일 블록이 거기서 끊기고 나머지가 본문으로 새어 나온다.
if (/<\/style|<!--/i.test(css)) {
  fail(
    `${href} contains a sequence that would close the inlined <style> block.`,
  );
}

// `<Links />`는 하이드레이션 때 클라이언트 매니페스트의 `css` 배열을 그대로 다시 그린다.
// 지금 요청이 한 번뿐인 것은 React 19가 같은 href의 <link>를 하나로 합쳐 주기 때문인데,
// HTML에서 <link>를 빼고 나면 합칠 상대가 없어 방금 인라인한 CSS를 네트워크로 한 번 더
// 받는다. 배열에서도 빼야 요청이 0이 된다.
const manifests = readdirSync(assetsDir).filter((name) =>
  /^manifest-.+\.js$/.test(name),
);

if (manifests.length !== 1) {
  fail(
    `expected exactly one assets/manifest-*.js, found ${manifests.length}. ` +
      "Without it the hydrating <Links /> would re-download the inlined stylesheet.",
  );
}

const manifestFile = join(assetsDir, manifests[0]);
const manifest = readFileSync(manifestFile, "utf8");

if (!manifest.includes(href)) {
  fail(
    `${manifests[0]} does not list ${href}, so this step is guarding nothing. ` +
      "React Router changed how route stylesheets are declared.",
  );
}

// 배열 전체를 갈아 끼운다. 원소가 하나뿐일 때만 맞는 패턴이라, 아래에서 href가 남아 있는지
// 다시 확인해 부분 치환을 걸러 낸다.
const strippedManifest = manifest.replaceAll(`["${href}"]`, "[]");

if (strippedManifest.includes(href)) {
  fail(
    `${manifests[0]} still references ${href} after stripping the root stylesheet. ` +
      "A route now ships more than one stylesheet; this rewrite cannot express that.",
  );
}

writeFileSync(manifestFile, strippedManifest);

// 치환 문자열을 함수로 넘긴다. CSS에 `$&` 같은 시퀀스가 들어 있으면 문자열 인자는 그것을
// 치환 지시로 읽는다.
const nextHtml = html.replace(tag, () => `<style>${css}</style>`);

// 아무도 가리키지 않는 파일을 남겨 두면 서비스 워커가 그대로 precache한다.
const dangling = [...walk(clientDir)]
  .filter((file) => file !== cssFile && /\.(js|html)$/.test(file))
  .filter((file) =>
    (file === indexHtml ? nextHtml : readFileSync(file, "utf8")).includes(href),
  )
  .map((file) => relative(clientDir, file));

if (dangling.length > 0) {
  fail(
    `${href} is still referenced by ${dangling.join(", ")}; leaving it in place.`,
  );
}

rmSync(cssFile);
writeFileSync(indexHtml, nextHtml);

console.log(
  `[css] inlined ${href} (${(css.length / 1024).toFixed(1)} kB) into index.html`,
);
