/**
 * 브라우저 탭의 안 읽음 표시. 탭 제목 앞의 `(3)`과 탭 아이콘(favicon) 오른쪽 위의 빨간 점이다.
 *
 * 홈 화면 아이콘 숫자(`app-badge.ts`)는 설치형 PWA에서만 보이므로, 일반 브라우저 탭으로 쓰는
 * 데스크톱 사용자에게는 이게 유일한 표시다. 아이콘은 16-32px로 그려져 숫자가 읽히지 않으므로
 * 점만 찍고 숫자는 제목이 맡는다.
 *
 * 둘 다 문서 `<head>`를 직접 고친다. React Router의 `<Meta>`/`<Links>`가 같은 노드를 그리지만
 * props가 바뀌지 않으면 DOM을 다시 쓰지 않는다. 제목은 자식 라우트 `meta`가 바꿀 수 있어
 * 표시하는 동안 `<head>` 변경을 지켜보고 숫자를 다시 붙인다.
 */

const TITLE_COUNT_PREFIX = /^\(\d+\+?\) /;
const MAX_TITLE_COUNT = 99;

const ICON_LINK_SELECTOR = 'link[rel~="icon"]';
const SVG_ICON_LINK_SELECTOR = `${ICON_LINK_SELECTOR}[type="image/svg+xml"]`;

/** 덮어쓰기 전 원래 아이콘 주소. 되돌릴 때 쓴다. */
const ORIGINAL_HREF_ATTR = "data-tab-badge-original-href";

/** 점의 크기와 위치는 아이콘 `viewBox` 대비 비율이다. 16px 탭에서 3px 남짓 보이는 크기다. */
const DOT_RADIUS_RATIO = 0.22;
const DOT_RING_RATIO = 0.05;
const DOT_COLOR = "#ef4444";
const DOT_RING_COLOR = "#ffffff";

let currentCount = 0;
let titleObserver: MutationObserver | null = null;
let badgedIconHref: Promise<string | null> | null = null;

/**
 * `count`가 0이면 원래 제목과 아이콘으로 되돌린다.
 *
 * 실패는 삼킨다. 아이콘을 못 만들어도 제목 숫자는 남고, 표시 하나 때문에 이걸 부르는
 * effect가 깨질 이유가 없다.
 */
export function setTabBadgeCount(count: number): void {
  if (typeof document === "undefined") return;

  const previousCount = currentCount;
  currentCount = Math.max(0, count);

  syncTitle();
  if (currentCount > 0) watchTitle();
  else unwatchTitle();

  if (previousCount > 0 !== currentCount > 0) void syncIcon();
}

function formatTitleCount(count: number): string {
  return count > MAX_TITLE_COUNT ? `${MAX_TITLE_COUNT}+` : String(count);
}

function syncTitle(): void {
  const base = document.title.replace(TITLE_COUNT_PREFIX, "");
  const next =
    currentCount > 0 ? `(${formatTitleCount(currentCount)}) ${base}` : base;

  // 같은 값을 다시 쓰면 observer가 또 깨어나 무한히 돈다.
  if (document.title !== next) document.title = next;
}

function watchTitle(): void {
  if (titleObserver) return;

  titleObserver = new MutationObserver(syncTitle);
  titleObserver.observe(document.head, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

function unwatchTitle(): void {
  titleObserver?.disconnect();
  titleObserver = null;
}

async function syncIcon(): Promise<void> {
  if (currentCount === 0) {
    restoreIcons();
    return;
  }

  badgedIconHref ??= createBadgedIconHref().catch(() => null);
  const href = await badgedIconHref;

  // 아이콘을 만드는 동안 모두 읽었으면 점을 찍지 않는다.
  if (href && currentCount > 0) replaceIcons(href);
}

/** SVG 아이콘에 점을 덧그린 data URL. 벡터 그대로라 탭 크기와 화면 배율에 상관없이 선명하다. */
async function createBadgedIconHref(): Promise<string | null> {
  const link = document.querySelector<HTMLLinkElement>(SVG_ICON_LINK_SELECTOR);
  const source = link?.getAttribute(ORIGINAL_HREF_ATTR) ?? link?.href;
  if (!source) return null;

  const response = await fetch(source);
  if (!response.ok) return null;

  const svg = new DOMParser().parseFromString(
    await response.text(),
    "image/svg+xml",
  ).documentElement;
  const viewBox = svg
    .getAttribute("viewBox")
    ?.split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length !== 4 || viewBox.some(Number.isNaN)) return null;

  const [minX, minY, width] = viewBox as [number, number, number, number];
  const radius = width * DOT_RADIUS_RATIO;
  const ring = width * DOT_RING_RATIO;
  const dot = svg.ownerDocument.createElementNS(svg.namespaceURI, "circle");
  dot.setAttribute("cx", String(minX + width - radius - ring / 2));
  dot.setAttribute("cy", String(minY + radius + ring / 2));
  dot.setAttribute("r", String(radius));
  dot.setAttribute("fill", DOT_COLOR);
  dot.setAttribute("stroke", DOT_RING_COLOR);
  dot.setAttribute("stroke-width", String(ring));
  svg.append(dot);

  const markup = new XMLSerializer().serializeToString(svg);
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
}

/**
 * `.ico`를 포함한 모든 아이콘 링크를 바꾼다. 브라우저마다 고르는 링크가 달라 하나만 바꾸면
 * 점이 안 보이는 브라우저가 생긴다. 바뀐 아이콘을 다시 읽지 않는 브라우저(Safari 등)에서는
 * 제목 숫자만 남는다.
 */
function replaceIcons(href: string): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    ICON_LINK_SELECTOR,
  )) {
    if (!link.hasAttribute(ORIGINAL_HREF_ATTR)) {
      link.setAttribute(ORIGINAL_HREF_ATTR, link.getAttribute("href") ?? "");
    }
    link.href = href;
  }
}

function restoreIcons(): void {
  for (const link of document.querySelectorAll<HTMLLinkElement>(
    `${ICON_LINK_SELECTOR}[${ORIGINAL_HREF_ATTR}]`,
  )) {
    link.setAttribute("href", link.getAttribute(ORIGINAL_HREF_ATTR) ?? "");
    link.removeAttribute(ORIGINAL_HREF_ATTR);
  }
}
