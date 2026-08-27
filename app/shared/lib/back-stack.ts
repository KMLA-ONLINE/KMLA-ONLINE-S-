import { generatePath, matchPath } from "react-router";

const HOME = "/";

/**
 * 딥링크로 앱에 처음 들어왔을 때 목적지 밑에 깔아 둘 화면들의 정의.
 *
 * 각 라우트의 "직속 부모"만 선언하고 체인은 위로 걸어 올라가며 만든다. 경로에서 세그먼트를
 * 떼어 부모를 유추하면 안 된다 — `/profile/:pubId`에서 한 칸 떼면 나오는 `/profile`은 그 사람
 * 화면의 상위가 아니라 "내 프로필"이다. 그래서 도출이 아니라 선언이다.
 *
 * 이 표는 **뒤로가기 내역이 없을 때 무엇으로 채울지**만 정의한다. 앱 안에서 이동해 들어온
 * 경우의 뒤로가기는 여기와 무관하게 "내가 온 곳"으로 남아야 하므로, 이 값으로 기존 내역을
 * 덮어쓰지 않는다.
 */
const PARENT_ROUTE: Record<string, string | null> = {
  "/": null,
  "/groups": HOME,
  "/groups/:slug": "/groups",
  "/groups/:slug/posts/:postId": "/groups/:slug",
  "/profile/:pubId": HOME,
  "/profile/:pubId/posts/:postId": "/profile/:pubId",
  "/noti": HOME,
  "/util/gongang": HOME,
};

/** react-router의 `createKey`와 같은 모양. entry끼리 구분만 되면 된다. */
function createEntryKey(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** `history.state`는 `any`라 좁혀서 쓴다. 라우터가 아직 쓰기 전이면 비어 있다. */
function currentState(): Record<string, unknown> {
  const state: unknown = window.history.state;
  return typeof state === "object" && state !== null
    ? (state as Record<string, unknown>)
    : {};
}

function currentIndex(): number {
  const index = currentState().idx;
  return typeof index === "number" ? index : 0;
}

/**
 * 목적지 아래에 깔려야 할 경로들. 루트부터 직속 부모까지 순서대로 돌려준다.
 *
 * 표에 없는 경로는 홈 하나만 깐다. 목적지가 홈이면 깔 것이 없다.
 */
export function resolveBackStack(destination: string): string[] {
  const pathname = destination.split(/[?#]/, 1)[0] ?? destination;

  let pattern: string | null = null;
  let params: Record<string, string> = {};
  for (const candidate of Object.keys(PARENT_ROUTE)) {
    const match = matchPath(candidate, pathname);
    if (!match) continue;
    pattern = candidate;
    params = Object.fromEntries(
      Object.entries(match.params).filter(
        (entry): entry is [string, string] => entry[1] !== undefined,
      ),
    );
    break;
  }

  if (pattern === null) return [HOME];

  const stack: string[] = [];
  for (
    let parent = PARENT_ROUTE[pattern];
    parent;
    parent = PARENT_ROUTE[parent]
  ) {
    stack.unshift(generatePath(parent, params));
  }
  return stack;
}

/** 이 창에 뒤로 갈 수 있는 entry가 있는가. 서비스 워커가 새 창으로 열었다면 항상 없다. */
export function hasBackEntry(): boolean {
  return window.history.length > 1;
}

/**
 * 목적지 밑에 화면들을 깔아 둔다. 라우터가 목적지로 이동하기 **직전에만** 부른다.
 *
 * 화면을 실제로 그리지 않고 history entry만 만든다. 사용자가 실제로 뒤로 갔을 때 비로소 그
 * 화면의 loader가 도므로, 깔아 두는 값이 몇 개든 진입 비용은 0이다.
 *
 * react-router의 history는 push할 때마다 entry state의 `idx`를 DOM에서 다시 읽는다. 그래서
 * 여기서 직접 entry를 쌓아도 라우터의 index 회계가 어긋나지 않는다. 첫 entry의 key를
 * `"default"`로 두는 것도 같은 이유다 — 라우터가 만들지 않은 세션 시작점이라는 뜻이고,
 * `useModalClose`가 그 신호를 읽는다.
 */
export function seedBackStack(stack: readonly string[]): void {
  const [ground, ...rest] = stack;
  if (ground === undefined) return;

  const base = currentIndex();
  window.history.replaceState(
    { ...currentState(), usr: null, key: "default", idx: base },
    "",
    ground,
  );
  rest.forEach((path, offset) => {
    window.history.pushState(
      { usr: null, key: createEntryKey(), idx: base + offset + 1 },
      "",
      path,
    );
  });
}
