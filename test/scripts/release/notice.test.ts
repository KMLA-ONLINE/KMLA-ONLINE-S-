import { describe, expect, it } from "vitest";

// Release scripts run directly under Node as MJS.
// @ts-expect-error The module is intentionally an untyped MJS module.
import * as notice from "../../../scripts/release/notice.mjs";

type Reply =
  | { status: number; text: string; after?: number }
  | { throws: Error; after?: number };

const { draftNotice } = notice as {
  draftNotice: (options: {
    models: string[];
    request: (
      model: string,
      timeoutMs: number,
    ) => Promise<{ status: number; text: string }>;
    now: () => number;
    sleep: (ms: number) => Promise<void>;
    random: () => number;
    log: (line: string) => void;
  }) => Promise<string>;
};

const ok = (text: string) => ({
  status: 200,
  text: JSON.stringify({
    candidates: [
      {
        finishReason: "STOP",
        content: { parts: [{ text: "생각", thought: true }, { text }] },
      },
    ],
  }),
});
const overloaded = { status: 503, text: '{"error":{"code":503}}' };

/** 모델마다 정한 응답을 차례로 돌려주는 가짜 Gemini와 시계. */
function gemini(replies: Record<string, Reply[]>) {
  let time = 0;
  const calls: { model: string; timeoutMs: number }[] = [];
  const waits: number[] = [];
  const logs: string[] = [];
  const run = () =>
    draftNotice({
      models: Object.keys(replies),
      request: (model, timeoutMs) => {
        calls.push({ model, timeoutMs });
        const reply = replies[model].shift();
        if (!reply) {
          return Promise.reject(new Error(`no reply left for ${model}`));
        }
        time += reply.after ?? 1_000;
        if ("throws" in reply) return Promise.reject(reply.throws);
        return Promise.resolve(reply);
      },
      now: () => time,
      sleep: (ms) => {
        waits.push(ms);
        time += ms;
        return Promise.resolve();
      },
      random: () => 0,
      log: (line) => logs.push(line),
    });
  return { run, calls, waits, logs };
}

describe("draftNotice", () => {
  it("backs off on overloads and returns the draft without thoughts", async () => {
    const fake = gemini({ a: [overloaded, overloaded, ok("초안")] });
    await expect(fake.run()).resolves.toBe("초안");
    expect(fake.waits).toEqual([15_000, 30_000]);
  });

  it("fails at once on an error that is not a network failure", async () => {
    const fake = gemini({
      a: [{ throws: new Error("Missing environment value: GEMINI_API_KEY") }],
      b: [ok("unused")],
    });
    await expect(fake.run()).rejects.toThrow("GEMINI_API_KEY");
    expect(fake.calls).toHaveLength(1);
  });

  it("retries a network failure like an overload", async () => {
    const fake = gemini({
      a: [{ throws: new TypeError("fetch failed") }, ok("초안")],
    });
    await expect(fake.run()).resolves.toBe("초안");
    expect(fake.waits).toEqual([15_000]);
  });

  it("moves past a model that times out without waiting on it", async () => {
    const timeout = new DOMException(
      "The operation timed out.",
      "TimeoutError",
    );
    const fake = gemini({
      a: [{ throws: timeout, after: 120_000 }],
      b: [ok("초안")],
    });
    await expect(fake.run()).resolves.toBe("초안");
    expect(fake.calls.map((call) => call.timeoutMs)).toEqual([
      120_000, 120_000,
    ]);
    expect(fake.waits).toEqual([]);
  });

  it("tries the next model when a wait would pass the budget", async () => {
    const fake = gemini({
      a: [{ ...overloaded, after: 410_000 }],
      b: [ok("초안")],
    });
    await expect(fake.run()).resolves.toBe("초안");
    expect(fake.waits).toEqual([]);
    expect(fake.calls[1].timeoutMs).toBe(10_000);
  });

  it("moves past a success reply that is not JSON", async () => {
    const fake = gemini({
      a: [{ status: 200, text: "<html>proxy error</html>" }],
      b: [ok("초안")],
    });
    await expect(fake.run()).resolves.toBe("초안");
  });

  it("reports each failure on one line with its reason but not the body", async () => {
    const badKey = JSON.stringify(
      {
        error: {
          code: 400,
          message: "API key not valid.\nPlease pass a valid API key.",
          status: "INVALID_ARGUMENT",
        },
      },
      null,
      2,
    );
    const cutOff = JSON.stringify(
      {
        candidates: [
          {
            finishReason: "MAX_TOKENS",
            content: { parts: [{ text: "잘린 초안" }] },
          },
        ],
      },
      null,
      2,
    );
    const fake = gemini({
      a: [{ status: 200, text: cutOff }],
      b: [{ status: 400, text: badKey }],
    });

    const error = await fake.run().catch((caught: Error) => caught);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).not.toContain("\n");
    expect((error as Error).message).toContain(
      "b attempt 1: 400 API key not valid.",
    );
    for (const line of fake.logs) expect(line).not.toContain("\n");
    expect(fake.logs.join(" ")).toContain("MAX_TOKENS");
    expect(fake.logs.join(" ")).not.toContain("잘린 초안");
  });
});
