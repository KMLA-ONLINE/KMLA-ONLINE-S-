import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RelativeTime } from "~/shared/components/relative-time";

const NOW = Date.parse("2026-08-09T12:00:00.000Z");

describe("RelativeTime", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("보이는 텍스트는 상대 시각이다", () => {
    render(<RelativeTime value={new Date(NOW - 3 * 60_000).toISOString()} />);

    expect(screen.getByText("3분전")).toBeInTheDocument();
  });

  it("스크린 리더에는 전체 시각을 따로 준다", () => {
    // `title`은 스크린 리더마다 읽는 규칙이 다르고 `dateTime`은 대부분 낭독되지 않으므로,
    // 보이는 쪽을 aria-hidden으로 감추고 읽히는 쪽을 sr-only로 둔다.
    const value = new Date(NOW - 3 * 60_000).toISOString();
    render(<RelativeTime value={value} />);

    expect(screen.getByText("3분전")).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText(/2026년/)).toHaveClass("sr-only");
  });

  it("machine-readable 값으로 원본 타임스탬프를 남긴다", () => {
    const value = new Date(NOW - 3 * 60_000).toISOString();
    render(<RelativeTime value={value} />);

    // `<time>`은 ARIA role이 없어 role로 질의할 수 없다. 그런데 `dateTime`을 어느 엘리먼트가
    // 들고 있는지가 바로 이 테스트의 계약이라, 여기서는 DOM 구조를 직접 봐야 한다.
    // eslint-disable-next-line testing-library/no-node-access -- 위 참고.
    const time = screen.getByText("3분전").closest("time");

    expect(time).toHaveAttribute("dateTime", value);
  });

  it("1분이 지나면 스스로 고쳐 쓴다", async () => {
    render(<RelativeTime value={new Date(NOW).toISOString()} />);
    expect(screen.getByText("방금")).toBeInTheDocument();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(screen.getByText("1분전")).toBeInTheDocument();
  });

  it("파싱할 수 없는 값이면 화면을 죽이지 않고 아무것도 그리지 않는다", () => {
    const { container } = render(<RelativeTime value="garbage" />);

    expect(container).toBeEmptyDOMElement();
  });
});
