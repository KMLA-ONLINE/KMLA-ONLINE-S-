import { screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { GroupPostDetail } from "~/features/posts/components/group/group-post-detail";
import { FROM_GROUP } from "~/features/posts/model/navigation";
import { groupPost } from "../../group-post-fixture";
import { renderRoute } from "../../../../router";

function renderDetail(post = groupPost(), state?: unknown) {
  return renderRoute(
    () => (
      <GroupPostDetail
        post={post}
        slug="study"
        groupName="스터디"
        viewer={{ name: "김서민", avatarUrl: null }}
        identities={["identified"]}
        comments={{ comments: [], nextCursor: null }}
      />
    ),
    { initialEntries: [{ pathname: "/", state }] },
  );
}

/**
 * 알림이나 피드에서 들어오면 뒤로가기는 사용자가 온 곳으로 돌아간다
 * (`routes/notification-open.tsx`). 그래서 이 링크가 게시물에서 그룹으로 가는 유일한 길이다 —
 * 지우면 알림으로 연 글에서 그룹에 닿을 방법이 없어진다.
 */
describe("GroupPostDetail 머리", () => {
  it("글이 놓인 그룹으로 보낸다", async () => {
    renderDetail();

    const link = await screen.findByRole("link", {
      name: "스터디 그룹으로 이동",
    });
    expect(link).toHaveAttribute("href", "/groups/study");
  });

  /**
   * 둘 다 목록에서 게시물을 찾고 가르는 표시다 — 왜 맨 위에 있는지, 어느 묶음으로 걸러지는지.
   * 상세에는 그 목록이 없어 설명할 것이 없다(기능 명세 §8.8).
   */
  it("카테고리와 고정 여부를 표시하지 않는다", async () => {
    renderDetail(groupPost({ is_pinned: true, category_name: "공지" }));

    await screen.findByRole("link", { name: "스터디 그룹으로 이동" });
    expect(screen.queryByText("고정된 게시물")).not.toBeInTheDocument();
    expect(screen.queryByText("공지")).not.toBeInTheDocument();
  });

  /**
   * 그룹 안에서 열었으면 뒤로가기가 이미 그룹을 내놓는다. 그 자리에 링크를 한 번 더 두지
   * 않는다 — 표식은 그룹 안쪽 링크만 심는다(`model/navigation.ts`).
   */
  it("그룹 안에서 들어왔으면 링크를 감춘다", async () => {
    renderDetail(groupPost(), FROM_GROUP);

    expect(await screen.findByText("본문")).toBeVisible();
    expect(
      screen.queryByRole("link", { name: "스터디 그룹으로 이동" }),
    ).not.toBeInTheDocument();
  });
});
