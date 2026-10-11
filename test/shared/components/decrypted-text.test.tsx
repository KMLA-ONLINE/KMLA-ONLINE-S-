import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecryptedText } from "~/shared/components/decrypted-text";

/** 보이는 쪽은 글자마다 `<span>`으로 쪼개져 있어 텍스트 질의로는 잡히지 않는다. */
function visibleText(container: HTMLElement) {
  return container.querySelector('[aria-hidden="true"]')?.textContent;
}

function stubReducedMotion(matches: boolean) {
  vi.spyOn(window, "matchMedia").mockReturnValue({
    matches,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as unknown as MediaQueryList);
}

describe("DecryptedText", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 풀의 첫 글자만 뽑히게 해서 뒤섞인 프레임을 단정할 수 있게 만든다.
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("첫 프레임부터 뒤섞인 상태로 그린다", () => {
    // 완성된 텍스트가 한 프레임 비쳤다가 뒤섞이면 깜빡임으로 보인다.
    const { container } = render(<DecryptedText text="404" />);

    expect(visibleText(container)).toBe("AAA");
  });

  it("뒤섞이는 동안에도 스크린 리더에는 완성된 텍스트를 준다", () => {
    // 하필 에러 화면에서 상태 코드가 난수로 낭독되는 일은 없어야 한다.
    const { container } = render(<DecryptedText text="404" />);

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(visibleText(container)).toBe("AAA");
    expect(screen.getByText("404")).toHaveClass("sr-only");
  });

  it("maxIterations를 채우면 원래 텍스트로 확정한다", () => {
    const { container } = render(
      <DecryptedText text="404" speed={50} maxIterations={10} />,
    );

    act(() => {
      vi.advanceTimersByTime(10 * 50);
    });

    expect(visibleText(container)).toBe("404");
  });

  it("sequential이면 앞에서부터 한 글자씩 확정한다", () => {
    const { container } = render(
      <DecryptedText text="404" speed={50} sequential />,
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(visibleText(container)).toBe("4AA");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(visibleText(container)).toBe("40A");

    act(() => {
      vi.advanceTimersByTime(50);
    });
    expect(visibleText(container)).toBe("404");
  });

  it("revealDirection이 end면 뒤에서부터 확정한다", () => {
    const { container } = render(
      <DecryptedText text="404" speed={50} sequential revealDirection="end" />,
    );

    act(() => {
      vi.advanceTimersByTime(50);
    });

    expect(visibleText(container)).toBe("AA4");
  });

  it("한글은 한글로 바꿔 줄 너비를 지킨다", () => {
    // 전각인 한글 자리에 반각 라틴이 들어가면 프레임마다 줄 너비가 출렁인다.
    // `Math.random`이 0이므로 한글은 모두 음절 영역의 첫 글자인 "가"가 된다.
    const { container } = render(<DecryptedText text="결석했어요" />);

    expect(visibleText(container)).toBe("가가가가가");
  });

  it("공백과 문장부호는 건드리지 않는다", () => {
    const { container } = render(
      <DecryptedText text="404 · 소재 불명" characters="0123456789" />,
    );

    expect(visibleText(container)).toBe("000 · 가가 가가");
  });

  it("prefers-reduced-motion이면 뒤섞지 않고 완성된 텍스트로 남는다", () => {
    stubReducedMotion(true);

    const { container } = render(<DecryptedText text="404" />);

    expect(visibleText(container)).toBe("404");

    act(() => {
      vi.advanceTimersByTime(10 * 50);
    });
    expect(visibleText(container)).toBe("404");
  });
});
