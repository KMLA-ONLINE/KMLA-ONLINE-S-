import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useClientNow } from "~/shared/hooks/use-client-now";

function Harness() {
  return <span data-testid="now">{useClientNow()}</span>;
}

describe("useClientNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("마운트 시점의 시각을 준다", () => {
    vi.setSystemTime(1_000);
    render(<Harness />);

    expect(screen.getByTestId("now")).toHaveTextContent("1000");
  });

  it("1분마다 갱신한다", async () => {
    render(<Harness />);
    expect(screen.getByTestId("now")).toHaveTextContent("0");

    await vi.advanceTimersByTimeAsync(60_000);

    expect(screen.getByTestId("now")).toHaveTextContent("60000");
  });

  it("구독자가 모두 사라졌다가 돌아오면 시계를 다시 읽는다", () => {
    // 마지막 구독자가 떠나면 타이머가 멈춘다. 그 사이 흐른 시간을 반영하지 않으면 다시
    // 마운트됐을 때 멈춰 있던 만큼 뒤처진 시각으로 첫 페인트가 나간다.
    const view = render(<Harness />);
    expect(screen.getByTestId("now")).toHaveTextContent("0");
    view.unmount();

    vi.setSystemTime(600_000);
    render(<Harness />);

    expect(screen.getByTestId("now")).toHaveTextContent("600000");
  });

  it("구독자가 남아 있으면 시계를 유지한다", () => {
    render(
      <>
        <Harness />
        <Harness />
      </>,
    );
    const [kept] = screen.getAllByTestId("now");

    // 한쪽만 사라져도 타이머는 계속 돌아야 하므로 값을 버리지 않는다.
    vi.setSystemTime(600_000);

    expect(kept).toHaveTextContent("0");
  });
});
