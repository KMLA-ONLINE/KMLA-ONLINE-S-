import { beforeEach, describe, expect, it, vi } from "vitest";

const mutations = vi.hoisted(() => ({
  restrictGroupAnonymousActivity: vi.fn(),
  cancelGroupAnonymousActivityRestriction: vi.fn(),
}));

vi.mock("~/features/posts/data/mutations", async (importOriginal) => ({
  ...(await importOriginal()),
  ...mutations,
}));

import { PostMenu } from "~/features/posts/components/post-menu";
import { renderRoute, screen, waitFor } from "../../../router";

function renderMenu(restricted = false) {
  const restrictionExpiresAt = restricted
    ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
    : null;
  return renderRoute(() => (
    <PostMenu
      editTo="/edit"
      canEdit={false}
      canDelete={false}
      canModerateAnonymous
      anonymousAuthorRestricted={restricted}
      anonymousAuthorRestrictionExpiresAt={restrictionExpiresAt}
      anonymousSourceId="post-id"
      onDelete={vi.fn()}
    />
  ));
}

describe("PostMenu anonymous activity moderation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutations.restrictGroupAnonymousActivity.mockResolvedValue({
      restriction_id: "restriction-id",
      expires_at: "2026-09-07T00:00:00Z",
    });
    mutations.cancelGroupAnonymousActivityRestriction.mockResolvedValue(
      undefined,
    );
  });

  it("validates, summarizes, then restricts only after confirmation", async () => {
    const { user } = renderMenu();
    await user.click(screen.getByRole("button", { name: "게시물 옵션" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "익명 활동 차단" }),
    );

    const durationInput = screen.getByLabelText("기간(일)");
    expect(durationInput).toHaveValue(1);
    expect(screen.getByText("0/300")).toBeInTheDocument();

    await user.type(screen.getByLabelText("사유"), "짧음");
    expect(screen.getByText("2/300")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "다음" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "사유를 5자 이상 입력해 주세요.",
    );

    await user.clear(screen.getByLabelText("사유"));
    await user.type(screen.getByLabelText("사유"), "반복적인 익명 괴롭힘");
    await user.clear(durationInput);
    await user.type(durationInput, "181");
    expect(durationInput).toHaveValue(180);
    await user.clear(durationInput);
    await user.type(durationInput, "0");
    expect(durationInput).toHaveValue(1);
    await user.clear(durationInput);
    await user.type(durationInput, "14");
    await user.click(screen.getByRole("button", { name: "다음" }));

    expect(mutations.restrictGroupAnonymousActivity).not.toHaveBeenCalled();
    expect(screen.getByText(/14일 동안/)).toBeInTheDocument();
    expect(screen.getByText(/사유: 반복적인 익명 괴롭힘/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "차단" }));

    await waitFor(() =>
      expect(mutations.restrictGroupAnonymousActivity).toHaveBeenCalledWith(
        "post",
        "post-id",
        "반복적인 익명 괴롭힘",
        14,
      ),
    );
  });

  it("shows an active restriction immediately and confirms cancellation", async () => {
    const { user } = renderMenu(true);
    await user.click(screen.getByRole("button", { name: "게시물 옵션" }));
    await user.click(
      await screen.findByRole("menuitem", {
        name: "익명 차단 해제",
      }),
    );

    expect(screen.getByText(/이미 이 그룹에서/)).toBeInTheDocument();
    expect(
      mutations.cancelGroupAnonymousActivityRestriction,
    ).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "차단 해제" }));
    expect(screen.getByText("익명 차단을 해제할까요?")).toBeInTheDocument();
    expect(
      screen.getByText("앞으로 7일 동안 익명 활동이 차단될 예정이었습니다."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "차단 해제" }));

    await waitFor(() =>
      expect(
        mutations.cancelGroupAnonymousActivityRestriction,
      ).toHaveBeenCalledWith("post", "post-id"),
    );
  });

  it("maps a duplicate response and switches to the cancellation flow", async () => {
    mutations.restrictGroupAnonymousActivity.mockRejectedValue({
      code: "55000",
      message: "anonymous activity restriction already active",
    });
    const { user } = renderMenu();
    await user.click(screen.getByRole("button", { name: "게시물 옵션" }));
    await user.click(
      await screen.findByRole("menuitem", { name: "익명 활동 차단" }),
    );
    await user.type(screen.getByLabelText("사유"), "이미 적용된 차단 사유");
    await user.click(screen.getByRole("button", { name: "다음" }));
    await user.click(screen.getByRole("button", { name: "차단" }));

    expect(
      await screen.findByText("이미 익명 활동이 차단된 사용자입니다."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "차단 해제" }),
    ).toBeInTheDocument();
  });
});
