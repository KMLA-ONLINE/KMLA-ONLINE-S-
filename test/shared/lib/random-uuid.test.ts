import { afterEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "~/shared/lib/random-uuid";
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
describe("randomUUID", () => {
  it("creates distinct RFC 4122 version 4 IDs without the secure-context API", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: crypto.getRandomValues.bind(crypto),
    });
    const ids = Array.from({ length: 32 }, () => randomUUID());
    expect(new Set(ids).size).toBe(32);
    for (const id of ids)
      expect(id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
  });
  it("uses the native UUID API when available", () => {
    const native = vi
      .spyOn(crypto, "randomUUID")
      .mockReturnValue("00000000-0000-4000-8000-000000000001");
    expect(randomUUID()).toBe("00000000-0000-4000-8000-000000000001");
    expect(native).toHaveBeenCalledOnce();
  });
});
