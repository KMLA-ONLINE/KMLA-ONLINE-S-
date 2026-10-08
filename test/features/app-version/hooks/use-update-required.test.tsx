import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useUpdateRequired } from "~/features/app-version";
import { CLIENT_COMPAT_VERSION } from "~/features/app-version/model/client-version";

const queries = vi.hoisted(() => ({ fetchMinClientVersion: vi.fn() }));
vi.mock("~/features/app-version/data/queries", () => queries);

describe("useUpdateRequired", () => {
  beforeEach(() => vi.stubEnv("PROD", true));
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("서버의 최소 버전이 이 빌드보다 높으면 막는다", async () => {
    queries.fetchMinClientVersion.mockResolvedValue(CLIENT_COMPAT_VERSION + 1);

    const { result } = renderHook(() => useUpdateRequired());

    await waitFor(() => expect(result.current).toBe(true));
  });

  it("같은 버전이면 막지 않는다", async () => {
    queries.fetchMinClientVersion.mockResolvedValue(CLIENT_COMPAT_VERSION);

    const { result } = renderHook(() => useUpdateRequired());

    await waitFor(() =>
      expect(queries.fetchMinClientVersion).toHaveBeenCalledOnce(),
    );
    expect(result.current).toBe(false);
  });

  it("확인이 실패하면 막지 않는다", async () => {
    queries.fetchMinClientVersion.mockRejectedValue(new Error("offline"));

    const { result } = renderHook(() => useUpdateRequired());

    await waitFor(() =>
      expect(queries.fetchMinClientVersion).toHaveBeenCalledOnce(),
    );
    expect(result.current).toBe(false);
  });
});
