import { describe, expect, it } from "vitest";

import {
  seoulInputToIso,
  toSeoulInput,
} from "~/features/donations/model/round-time";

describe("donation round Seoul time inputs", () => {
  it("formats a stored instant in Seoul time", () => {
    expect(toSeoulInput("2026-10-14T00:30:45Z")).toBe("2026-10-14T09:30");
  });

  it("converts a Seoul input to an ISO instant", () => {
    expect(seoulInputToIso("2026-10-14T09:30")).toBe(
      "2026-10-14T00:30:00.000Z",
    );
  });

  it("keeps the stored seconds when the input was not changed", () => {
    expect(
      seoulInputToIso("2026-10-14T09:30", "2026-10-14T00:30:45+00:00"),
    ).toBe("2026-10-14T00:30:45.000Z");
  });

  it("uses the edited minute when the input changed", () => {
    expect(
      seoulInputToIso("2026-10-14T10:00", "2026-10-14T00:30:45+00:00"),
    ).toBe("2026-10-14T01:00:00.000Z");
  });

  it("rejects empty input", () => {
    expect(seoulInputToIso("")).toBeNull();
  });
});
