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

  it("returns to the inbox after closing a post opened from the inbox", async () => {
    function Post() {
      const navigate = useNavigate();
      return <button onClick={() => void navigate(-1)}>게시물 닫기</button>;
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
        initialEntries={[
          "/noti",
          {
            pathname: "/noti/open/notification-id",
            state: { fromNotificationInbox: true },
          },
        ]}
        initialIndex={1}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "게시물 닫기" }));
    expect(await screen.findByText("알림함")).toBeVisible();
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
