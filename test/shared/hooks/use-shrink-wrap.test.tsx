import { render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";

import { useShrinkWrap } from "~/shared/hooks/use-shrink-wrap";

// jsdom은 레이아웃을 하지 않으므로 상자 폭 300px, 두 줄 중 긴 줄 100px인 버블을 흉내 낸다. 인용은
// 최소 폭 없이 그리면 `quoteFitWidth`가 되고, 최소 폭(`min-w-full`)이 있으면 상자 폭을 채운다.
function Subject({ quoteFitWidth }: { quoteFitWidth: number }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const quoteRef = useRef<HTMLButtonElement>(null);
  useShrinkWrap(boxRef, textRef, {
    enabled: true,
    contentKey: "body",
    minContentRef: quoteRef,
  });
  return (
    <div ref={boxRef} data-testid="box">
      <button
        ref={(node) => {
          quoteRef.current = node;
          if (!node) return;
          node.getBoundingClientRect = () =>
            ({
              width: node.style.minWidth === "0px" ? quoteFitWidth : 300,
            }) as DOMRect;
        }}
      />
      <span
        ref={(node) => {
          textRef.current = node;
          if (!node) return;
          node.getClientRects = () =>
            [{ right: 60 }, { right: 100 }] as unknown as DOMRectList;
        }}
      />
    </div>
  );
}

function renderSubject(quoteFitWidth: number) {
  vi.spyOn(HTMLDivElement.prototype, "getBoundingClientRect").mockReturnValue({
    left: 0,
    width: 300,
  } as DOMRect);
  render(<Subject quoteFitWidth={quoteFitWidth} />);
  return screen.getByTestId("box");
}

describe("useShrinkWrap", () => {
  it("does not shrink below the width the quote asks for", () => {
    expect(renderSubject(150)).toHaveStyle({ width: "150px" });
  });

  it("shrinks to the longest line when the quote is narrower", () => {
    expect(renderSubject(40)).toHaveStyle({ width: "100px" });
  });
});
