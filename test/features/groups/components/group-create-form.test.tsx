import { redirect, useNavigationType } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { GroupCreateForm } from "~/features/groups/components/group-create-form";
import { renderRoute, screen, within } from "../../../router";

describe("GroupCreateForm", () => {
  // 만든 뒤 뒤로가기가 생성 화면을 다시 열지 않게, 새 그룹이 생성 화면 자리를 차지한다.
  it("replaces itself with the new group after creating it", async () => {
    function Group() {
      return <p>{`새 그룹 ${useNavigationType()}`}</p>;
    }
    const { user } = renderRoute(
      () => <GroupCreateForm canCreateOfficial={false} pending={false} />,
      {
        path: "/groups/create",
        action: () => redirect("/groups/new-group"),
        routes: [{ path: "/groups/new-group", Component: Group }],
      },
    );

    await user.type(
      screen.getByRole("textbox", { name: "그룹 이름" }),
      "새 그룹",
    );
    await user.click(screen.getByRole("button", { name: "그룹 만들기" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("가입 방식");
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "만들기",
      }),
    );

    expect(await screen.findByText("새 그룹 REPLACE")).toBeInTheDocument();
  });

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
          hideStaffRoles: false,
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

  it("offers joining and identity choices with user-facing policy labels", () => {
    renderRoute(() => (
      <GroupCreateForm canCreateOfficial={false} pending={false} />
    ));

    expect(screen.getByRole("combobox", { name: "가입 방식" })).toHaveValue(
      "invite_only",
    );
    expect(
      screen.getByText("소유자·관리자·매니저만 게시물을 작성할 수 있습니다."),
    ).toBeVisible();
    expect(
      screen.getByText(
        "소유자와 관리자를 제외한 멤버 목록에서는 운영진도 일반 멤버처럼 표시합니다.",
      ),
    ).toBeVisible();
    const identity = screen.getByRole("combobox", { name: "실명·익명 설정" });
    expect(identity).toHaveValue("optional_anonymous");
    expect(within(identity).getAllByRole("option")).toHaveLength(2);
    expect(
      within(identity).getByRole("option", { name: "실명만" }),
    ).toBeVisible();
    expect(
      within(identity).getByRole("option", { name: "작성할 때 선택" }),
    ).toBeVisible();
  });

  it("uses independent checkboxes for staff-only posting and role hiding", async () => {
    const { user } = renderRoute(() => (
      <GroupCreateForm canCreateOfficial={false} pending={false} />
    ));
    const staffOnly = screen.getByRole("checkbox", {
      name: "운영진만 게시 가능",
    });
    const hideStaffRoles = screen.getByRole("checkbox", {
      name: "일반 멤버에게 운영진 역할 숨기기",
    });

    expect(staffOnly).not.toBeChecked();
    expect(hideStaffRoles).not.toBeChecked();
    await user.click(staffOnly);
    await user.click(hideStaffRoles);

    expect(staffOnly).toBeChecked();
    expect(hideStaffRoles).toBeChecked();
    const form = staffOnly.closest("form");
    expect(form).not.toBeNull();
    const values = new FormData(form!);
    expect(values.get("postingPolicy")).toBe("staff");
    expect(values.get("hideStaffRoles")).toBe("true");
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

describe("GroupCreateForm in English", () => {
  afterEach(() => window.localStorage.clear());

  it("renders the creation form in English", () => {
    window.localStorage.setItem("kmla-online:language:v1", "en");
    renderRoute(() => (
      <GroupCreateForm canCreateOfficial={false} pending={false} />
    ));

    expect(
      screen.getByRole("heading", { name: "Create group" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Group name" })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Join policy" })).toBeVisible();
    expect(
      screen.getByText("Private groups use a random address."),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Create group" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });
});
