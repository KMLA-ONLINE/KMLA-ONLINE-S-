import { act, renderHook, waitFor } from "@testing-library/react";
import { ReadableStream } from "node:stream/web";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  managedDownloadNote,
  useManagedDownload,
} from "~/shared/hooks/use-managed-download";
import { fetchFiles, fileTypeFor } from "~/shared/lib/file-download";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const IPHONE_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";

const TARGET = { url: "https://storage.example/a", fileName: "시간표.pdf" };

function useUserAgent(userAgent: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    value: userAgent,
  });
}

function stubFetch(body = "%PDF-1.7", status = 200) {
  const fetchMock = vi.fn(() =>
    Promise.resolve(
      new Response(body, {
        status,
        headers: { "content-length": String(body.length) },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function stubShare(canShare: boolean, share = vi.fn(() => Promise.resolve())) {
  Object.defineProperty(navigator, "canShare", {
    configurable: true,
    value: vi.fn(() => canShare),
  });
  Object.defineProperty(navigator, "share", {
    configurable: true,
    value: share,
  });
  return share;
}

/** jsdom에는 Blob URL이 없다. 다운로드 폴더 저장은 Blob 링크 클릭으로 본다. */
function stubAnchorSave() {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: () => "blob:x",
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: () => undefined,
  });
  return vi
    .spyOn(HTMLAnchorElement.prototype, "click")
    .mockImplementation(() => undefined);
}

const click = () => ({ preventDefault: vi.fn() });

beforeEach(() => useUserAgent(ANDROID_CHROME));

afterEach(() => {
  Reflect.deleteProperty(navigator, "userAgent");
  Reflect.deleteProperty(navigator, "canShare");
  Reflect.deleteProperty(navigator, "share");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
});

describe("fetchFiles", () => {
  it("reports progress and names the file by its extension, not the server type", async () => {
    stubFetch("12345678");
    const progress: (number | null)[] = [];
    const [file] = await fetchFiles([TARGET], {
      onProgress: (ratio) => progress.push(ratio),
    });
    expect(file.name).toBe("시간표.pdf");
    expect(file.type).toBe("application/pdf");
    expect(progress.at(-1)).toBe(1);
  });

  it("falls back to a generic type for unknown extensions", () => {
    expect(fileTypeFor("명단.xlsx")).toBe("application/octet-stream");
    expect(fileTypeFor("사진.WEBP")).toBe("image/webp");
  });

  it("rejects a failed response", async () => {
    stubFetch("", 403);
    await expect(fetchFiles([TARGET])).rejects.toThrow("403");
  });
});

describe("useManagedDownload", () => {
  it("leaves the link alone on desktop", () => {
    Reflect.deleteProperty(navigator, "userAgent");
    const fetchMock = stubFetch();
    const { result } = renderHook(() => useManagedDownload());
    const event = click();

    act(() => result.current.handleClick(event, [TARGET]));

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("on Android, downloads on the first tap and saves to the downloads folder on the second", async () => {
    stubFetch();
    const share = stubShare(true);
    const anchorClick = stubAnchorSave();
    const { result } = renderHook(() => useManagedDownload());

    const first = click();
    act(() => result.current.handleClick(first, [TARGET]));
    expect(first.preventDefault).toHaveBeenCalled();
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    expect(anchorClick).not.toHaveBeenCalled();

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() =>
      expect(result.current.state).toEqual({
        status: "saved",
        location: "downloads",
        shareable: true,
      }),
    );
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());
    // 공유 시트에는 기기 저장 항목이 없을 수 있어 저장이 먼저고, 공유는 저장한 뒤 다시 탭해 한다.
    expect(share).not.toHaveBeenCalled();
    expect(managedDownloadNote(result.current.state)).toBe(
      "다운로드 폴더에 저장됨",
    );
    expect(toast.success).not.toHaveBeenCalled();

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() => expect(share).toHaveBeenCalledOnce());
    const [[data]] = share.mock.calls as unknown as [[{ files: File[] }]];
    expect(data.files.map((file) => file.name)).toEqual(["시간표.pdf"]);
    expect(result.current.state.status).toBe("saved");
  });

  it("on Android, saves again instead of sharing files the share sheet refuses", async () => {
    stubFetch();
    stubShare(false);
    const anchorClick = stubAnchorSave();
    const { result } = renderHook(() => useManagedDownload());

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(() => result.current.save());

    expect(result.current.state).toEqual({
      status: "saved",
      location: "downloads",
      shareable: false,
    });
    // 저장은 타이머로 미뤄진다. 다음 테스트로 새지 않게 끝까지 기다린다.
    await waitFor(() => expect(anchorClick).toHaveBeenCalledOnce());

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() => expect(anchorClick).toHaveBeenCalledTimes(2));
  });

  it("on iOS, saves through the share sheet", async () => {
    useUserAgent(IPHONE_SAFARI);
    stubFetch();
    const share = stubShare(true);
    const anchorClick = stubAnchorSave();
    const { result } = renderHook(() => useManagedDownload());

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(() => result.current.save());

    expect(share).toHaveBeenCalledOnce();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe("saved");
  });

  it("on iOS, stays ready when the share sheet is dismissed", async () => {
    useUserAgent(IPHONE_SAFARI);
    stubFetch();
    stubShare(
      true,
      vi.fn(() => Promise.reject(new DOMException("cancelled", "AbortError"))),
    );
    const { result } = renderHook(() => useManagedDownload());

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    await act(() => result.current.save());

    expect(result.current.state.status).toBe("ready");
  });

  it("ignores a second save tap while the share sheet is opening", async () => {
    useUserAgent(IPHONE_SAFARI);
    stubFetch();
    let finishShare: () => void = () => undefined;
    const share = stubShare(
      true,
      vi.fn(
        () =>
          new Promise<void>((resolve) => {
            finishShare = resolve;
          }),
      ),
    );
    const anchorClick = stubAnchorSave();
    const { result } = renderHook(() => useManagedDownload());

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() => expect(result.current.state.status).toBe("ready"));
    let first: Promise<void> = Promise.resolve();
    act(() => {
      first = result.current.save();
    });
    await act(() => result.current.save());
    finishShare();
    await act(() => first);

    expect(share).toHaveBeenCalledOnce();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it("shows the failure so the next tap retries", async () => {
    const fetchMock = stubFetch("", 500);
    const { result } = renderHook(() => useManagedDownload());

    act(() => result.current.handleClick(click(), [TARGET]));
    await waitFor(() => expect(result.current.state.status).toBe("failed"));

    act(() => result.current.handleClick(click(), [TARGET]));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("stays failed when one file of a batch fails while another is still arriving", async () => {
    let push: (chunk: Uint8Array) => void = () => undefined;
    const slow = new ReadableStream<Uint8Array>({
      start(controller) {
        push = (chunk) => controller.enqueue(chunk);
      },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        Promise.resolve(
          url.endsWith("slow")
            ? // node:stream/web의 타입이 DOM 타입과 이름만 달라 맞춰 준다.
              new Response(slow as unknown as BodyInit, {
                headers: { "content-length": "100" },
              })
            : new Response("", { status: 403 }),
        ),
      ),
    );
    const { result } = renderHook(() => useManagedDownload());

    act(() =>
      result.current.handleClick(click(), [
        { url: "https://storage.example/slow", fileName: "a.webp" },
        { url: "https://storage.example/gone", fileName: "b.webp" },
      ]),
    );
    await waitFor(() => expect(result.current.state.status).toBe("failed"));
    act(() => push(new Uint8Array(10)));
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(result.current.state.status).toBe("failed");
  });

  it("announces the failure and returns to idle when given a failure message", async () => {
    stubFetch("", 500);
    const { result } = renderHook(() =>
      useManagedDownload({ failureMessage: "사진을 받지 못했어요" }),
    );

    act(() => result.current.handleClick(click(), [TARGET]));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("사진을 받지 못했어요"),
    );
    expect(result.current.state.status).toBe("idle");
  });
});
