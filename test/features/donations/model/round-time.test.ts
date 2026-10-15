import { describe, expect, it } from "vitest";

import {
  roundPhase,
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

describe("donation round phase", () => {
  const now = Date.parse("2026-10-14T00:00:00Z");

  it("trusts the server open flag", () => {
    expect(
      roundPhase({ opens_at: "2026-10-15T00:00:00Z", is_open: true }, now),
    ).toBe("open");
  });

  it("separates upcoming and ended closed rounds", () => {
    expect(
      roundPhase({ opens_at: "2026-10-15T00:00:00Z", is_open: false }, now),
    ).toBe("upcoming");
    expect(
      roundPhase({ opens_at: "2026-10-13T00:00:00Z", is_open: false }, now),
    ).toBe("ended");
  });
});
