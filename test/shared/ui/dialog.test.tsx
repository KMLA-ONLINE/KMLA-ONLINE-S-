import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Dialog, DialogContent, DialogTitle } from "~/shared/ui/dialog";

// 스크림은 `role="presentation"`이라 접근성 트리에 없다. Testing Library의 쿼리로는 잡을 수
// 없고, 여기서 확인하려는 것이 "그 요소가 그려졌는가" 자체라 DOM을 직접 센다.
const overlays = () =>
  // eslint-disable-next-line testing-library/no-node-access
  document.querySelectorAll('[data-slot="dialog-overlay"]');

describe("dialog overlay", () => {
  it("dims the page behind a lone dialog", () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>바깥</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(overlays()).toHaveLength(1);
  });

  it("dims the dialog behind a nested one", () => {
    // Base UI는 중첩된 dialog의 backdrop을 기본적으로 렌더하지 않는다. 게시물 상세처럼 화면을
    // 거의 덮는 모달 위에서는 그 위에 뜬 dialog만 배경 없이 떠 있는 것처럼 보여서 되돌려 뒀다.
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>바깥</DialogTitle>
          <ConfirmDialog
            title="안쪽"
            description="설명"
            confirmLabel="확인"
            onCancel={vi.fn()}
            onConfirm={vi.fn()}
          />
        </DialogContent>
      </Dialog>,
    );

    expect(screen.getByText("안쪽")).toBeInTheDocument();
    expect(overlays()).toHaveLength(2);
  });

  it("keeps the scrim free of backdrop filters", () => {
    // blur는 스크림을 별도 합성 레이어로 만들어 모달이 페이드하는 동안 1px 이음매를 남긴다.
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>바깥</DialogTitle>
        </DialogContent>
      </Dialog>,
    );

    expect(overlays()[0]?.className).not.toMatch(/backdrop-blur/);
  });
});
