import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { ConversationAvatar } from "~/features/messaging/components/conversation-avatar";
import type * as AvatarModule from "~/shared/ui/avatar";
import type { ConversationSummary } from "~/features/messaging/model/types";

// Base UI의 Avatar.Image는 사진이 실제로 로드된 뒤에만 그려지는데 jsdom은 이미지를 로드하지 않는다.
// 어떤 사진을 어떤 이름으로 그리는지만 보려고 바로 그리는 img로 바꾼다.
vi.mock("~/shared/ui/avatar", async (importOriginal) => {
  const actual = await importOriginal<typeof AvatarModule>();
  return {
    ...actual,
    AvatarImage: ({ src, alt }: ComponentProps<"img">) => (
      <img src={src} alt={alt} />
    ),
  };
});

const group: Pick<
  ConversationSummary,
  "type" | "name" | "participants" | "viewerId" | "imageUrl"
> = {
  type: "group",
  name: "영화 동아리",
  viewerId: "me",
  participants: [
    { id: "me", name: "나", avatarUrl: null, active: true },
    { id: "a", name: "박서현", avatarUrl: null, active: true },
    { id: "b", name: "최민준", avatarUrl: null, active: true },
  ],
  imageUrl: null,
};

describe("ConversationAvatar", () => {
  it("그룹 사진이 있으면 멤버 사진 조합 대신 그 사진 하나를 그린다", () => {
    render(
      <ConversationAvatar
        conversation={{ ...group, imageUrl: "https://signed/group.webp" }}
      />,
    );

    const image = screen.getByRole("img", { name: "영화 동아리 그룹 사진" });
    expect(image).toHaveAttribute("src", "https://signed/group.webp");
    expect(screen.queryByAltText(/프로필 사진/)).not.toBeInTheDocument();
  });

  it("그룹 사진이 없으면 멤버 사진을 겹쳐 그린다", () => {
    render(<ConversationAvatar conversation={group} />);

    expect(
      screen.queryByRole("img", { name: /그룹 사진/ }),
    ).not.toBeInTheDocument();
  });
});
