import { describe, expect, it } from "vitest";

import { GroupCreateForm } from "~/features/groups/components/group-create-form";
import { renderRoute, screen, within } from "../../../router";

describe("GroupCreateForm", () => {
  it("shows the address warning only when creating a public group", async () => {
    const { user: privateUser, unmount } = renderRoute(() => (
      <GroupCreateForm canCreateOfficial={false} pending={false} />
    ));

    await privateUser.type(
      screen.getByRole("textbox", { name: "그룹 이름" }),
      "비공개 그룹",
    );
    await privateUser.click(
      screen.getByRole("button", { name: "그룹 만들기" }),
    );

    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "그룹 주소는 후에 수정할 수 없습니다.",
    );
    expect(screen.getByRole("dialog")).not.toHaveTextContent(
      "공개그룹으로 전환 후에는 비공개로 변경할 수 없습니다.",
    );
    unmount();

    const { user: publicUser } = renderRoute(() => (
      <GroupCreateForm
        canCreateOfficial={false}
        pending={false}
        values={{
          kind: "unofficial",
          name: "",
          description: "",
          slug: "",
          joinPolicy: "open",
          identityPolicy: "optional_anonymous",
          postingPolicy: "members",
        }}
      />
    ));

    await publicUser.type(
      screen.getByRole("textbox", { name: "그룹 이름" }),
      "공개 그룹",
    );
    await publicUser.click(screen.getByRole("button", { name: "그룹 만들기" }));

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "그룹 주소는 후에 수정할 수 없습니다.",
    );
  });

  it("offers identified and optional-anonymous activity", () => {
    renderRoute(() => (
      <GroupCreateForm canCreateOfficial={false} pending={false} />
    ));

    const identity = screen.getByRole("combobox", { name: "활동 신원" });
    expect(identity).toHaveValue("optional_anonymous");
    expect(within(identity).getAllByRole("option")).toHaveLength(2);
    expect(
      within(identity).getByRole("option", { name: "실명만" }),
    ).toBeVisible();
    expect(
      within(identity).getByRole("option", { name: "작성할 때 선택" }),
    ).toBeVisible();
  });

  it("requires a second confirmation before creating an official group", async () => {
    const { user } = renderRoute(() => (
      <GroupCreateForm canCreateOfficial pending={false} />
    ));

    await user.selectOptions(
      screen.getByRole("combobox", { name: "그룹 종류" }),
      "official",
    );
    await user.type(
      screen.getByRole("textbox", { name: "그룹 이름" }),
      "공식 확인 그룹",
    );
    await user.click(screen.getByRole("button", { name: "그룹 만들기" }));

    const firstConfirmation = screen.getByRole("dialog");
    expect(firstConfirmation).toHaveTextContent("공식 그룹");
    await user.click(
      within(firstConfirmation).getByRole("button", { name: "만들기" }),
    );

    const officialConfirmation = screen.getByRole("dialog");
    expect(officialConfirmation).toHaveTextContent(
      "승인된 모든 재학생이 자동으로 가입합니다.",
    );
    expect(officialConfirmation).toHaveTextContent(
      "공식 그룹은 앱 관리자만 삭제할 수 있습니다.",
    );
    expect(
      within(officialConfirmation).getByRole("button", {
        name: "공식 그룹 만들기",
      }),
    ).toBeVisible();
  });
});
