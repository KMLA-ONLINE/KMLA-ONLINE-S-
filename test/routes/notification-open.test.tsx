import { fireEvent, render, screen } from "@testing-library/react";
import {
  createRoutesStub,
  RouterContextProvider,
  useNavigate,
} from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveNotificationDestination: vi.fn(),
}));

vi.mock("~/features/notifications", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  resolveNotificationDestination: mocks.resolveNotificationDestination,
}));

import NotificationOpenRoute, {
  clientLoader,
} from "~/routes/notification-open";

function load(notificationId = "notification-id") {
  const url = `https://example.com/noti/open/${notificationId}`;
  return clientLoader({
    params: { notificationId },
    context: new RouterContextProvider(),
    request: new Request(url),
    url: new URL(url),
    pattern: "/noti/open/:notificationId",
    serverLoader: () => Promise.resolve(undefined),
  });
}

/**
 * loader는 `Location`을 실어 Response를 던진다. 잡은 뒤에만 단정하면 리다이렉트가 사라졌을 때
 * 단정식이 한 번도 돌지 않고 통과하므로, 여기서 "던지지 않았다"를 실패로 바꿔 둔다.
 */
async function redirection(notificationId?: string): Promise<Response> {
  try {
    await load(notificationId);
  } catch (thrown) {
    expect(thrown).toBeInstanceOf(Response);
    return thrown as Response;
  }
  throw new Error("Expected the loader to redirect");
}

async function redirectLocation(notificationId?: string): Promise<string> {
  return (await redirection(notificationId)).headers.get("Location") ?? "";
}

/** `replace()`가 붙이는 표시. 이게 없으면 라우터는 resolver entry를 history에 남긴다. */
function replaces(response: Response): boolean {
  return response.headers.get("X-Remix-Replace") === "true";
}

/** jsdom의 history는 파일 안에서 공유되므로, 돌아갈 내역의 유무를 직접 정한다. */
function setBackEntry(present: boolean): void {
  Object.defineProperty(window.history, "length", {
    configurable: true,
    get: () => (present ? 2 : 1),
  });
}

describe("notification open route", () => {
  const seeded = { pushed: [] as string[], replaced: [] as string[] };

  beforeEach(() => {
    vi.clearAllMocks();
    seeded.pushed = [];
    seeded.replaced = [];
    vi.spyOn(window.history, "pushState").mockImplementation((_s, _t, url) => {
      seeded.pushed.push(String(url));
    });
    vi.spyOn(window.history, "replaceState").mockImplementation(
      (_s, _t, url) => {
        seeded.replaced.push(String(url));
      },
    );
    setBackEntry(true);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window.history, "length");
  });

  it("redirects an authenticated user only to a safe resolved path", async () => {
    mocks.resolveNotificationDestination.mockResolvedValue("//evil.example");

    await expect(load()).resolves.toEqual({ target: "/noti" });
  });

  it("preserves only the fixed resolver path when authentication is missing", async () => {
    mocks.resolveNotificationDestination.mockResolvedValue(null);

    await expect(redirectLocation("id with spaces")).resolves.toBe(
      "/login?next=%2Fnoti%2Fopen%2Fid%2520with%2520spaces",
    );
  });

  it("replaces its own entry when authentication is missing", async () => {
    mocks.resolveNotificationDestination.mockResolvedValue(null);
    expect(replaces(await redirection())).toBe(true);
  });

  /**
   * 게시물은 그룹 위에 오버레이로 열리고 닫기는 바로 밑 entry를 드러낸다. 알림함에서 열었다면
   * 그 자리가 알림함이라, 부모를 끼워 넣지 않으면 글이 놓여 있던 그룹으로 갈 방법이 없다.
   */
  /**
   * 알림을 한 번 눌렀으면 entry도 하나여야 한다. 게시물이 그룹 위에 얹히는 오버레이라는 이유로
   * 그룹을 끼워 넣으면, 가본 적 없는 화면이 뒤로가기에서 나오고 알림함은 두 번 눌러야 나온다.
   */
  it("returns to the inbox from a post opened there", async () => {
    function Post() {
      const navigate = useNavigate();
      return <button onClick={() => void navigate(-1)}>뒤로</button>;
    }
    const Stub = createRoutesStub([
      { path: "/noti", Component: () => <p>알림함</p> },
      {
        path: "/noti/open/:notificationId",
        Component: NotificationOpenRoute,
        loader: () => ({ target: "/groups/study/posts/post-id" }),
      },
      { path: "/groups/study/posts/post-id", Component: Post },
    ]);

    render(
      <Stub
        initialEntries={["/noti", "/noti/open/notification-id"]}
        initialIndex={1}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "뒤로" }));
    expect(await screen.findByText("알림함")).toBeVisible();
    expect(seeded.replaced).toEqual([]);
    expect(seeded.pushed).toEqual([]);
  });

  /**
   * 앱이 떠 있는 채로 push를 누르면 서비스 워커가 그 창을 이 route로 보낸다. 사용자가 보던
   * 화면이 밑에 그대로 있으므로 뒤로가기는 그리로 돌아가야 한다 — 목적지가 오버레이인지는
   * 상관이 없다.
   */
  it("leaves the screen the user was on under a push-opened post", async () => {
    function Post() {
      const navigate = useNavigate();
      return <button onClick={() => void navigate(-1)}>뒤로</button>;
    }
    const Stub = createRoutesStub([
      { path: "/messenger", Component: () => <p>메신저</p> },
      {
        path: "/noti/open/:notificationId",
        Component: NotificationOpenRoute,
        loader: () => ({ target: "/groups/study/posts/post-id" }),
      },
      { path: "/groups/study/posts/post-id", Component: Post },
    ]);

    render(
      <Stub
        initialEntries={["/messenger", "/noti/open/notification-id"]}
        initialIndex={1}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "뒤로" }));
    expect(await screen.findByText("메신저")).toBeVisible();
    expect(seeded.replaced).toEqual([]);
    expect(seeded.pushed).toEqual([]);
  });

  /**
   * 앱이 종료된 상태에서 push로 열린 창에는 돌아갈 화면이 없다. 목적지가 앱 안에서 놓여 있던
   * 자리를 밑에 깔고 그 위에 목적지를 얹어야 뒤로가기가 "게시물이 닫히고 그룹 화면"이 된다.
   */
  it("seeds the destination's own place when there is nothing to go back to", async () => {
    setBackEntry(false);
    const Stub = createRoutesStub([
      {
        path: "/noti/open/:notificationId",
        Component: NotificationOpenRoute,
        loader: () => ({ target: "/groups/study/posts/post-id" }),
      },
      {
        path: "/groups/study/posts/post-id",
        Component: () => <p>게시물</p>,
      },
    ]);

    render(<Stub initialEntries={["/noti/open/notification-id"]} />);

    expect(await screen.findByText("게시물")).toBeVisible();
    // 깔아 둔 마지막 entry 위로 얹어야 하므로 이 갈래만 push다.
    expect(seeded.replaced).toEqual(["/"]);
    expect(seeded.pushed).toEqual(["/groups", "/groups/study"]);
  });
});
