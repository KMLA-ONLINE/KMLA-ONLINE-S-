import { describe, expect, it } from "vitest";
import { createRoutesStub, data } from "react-router";

import { GroupSettings } from "~/features/groups/components/group-settings";
import type { GroupDetail } from "~/features/groups/model/types";
import {
  render,
  renderRoute,
  screen,
  userEvent,
  waitFor,
  within,
} from "../../../router";

const group: GroupDetail = {
  id: "group-1",
  group_id: "group-1",
  slug: "group",
  name: "테스트 그룹",
  description: "설명",
  kind: "unofficial",
  join_policy: "request",
  identity_policy: "identified",
  posting_policy: "members",
  icon_path: null,
  cover_path: null,
  member_count: 1,
  membership_state: "member",
  member_role: "owner",
  requested_at: null,
  pinned_at: null,
};

describe("GroupSettings", () => {
  it("allows owners to edit basic information and policies", async () => {
    const { user } = renderRoute(() => (
      <GroupSettings group={group} categories={[]} />
    ));

    await user.click(screen.getByRole("button", { name: "기본 정보 편집" }));
    expect(screen.getByLabelText("그룹 이름")).toHaveValue("테스트 그룹");
    await user.click(screen.getByRole("button", { name: "가입 방식 변경" }));
    expect(screen.getByRole("combobox", { name: "가입 방식" })).toHaveValue(
      "request",
    );
    expect(screen.getAllByRole("button", { name: "저장" })).toHaveLength(2);
    expect(screen.getByText("그룹 프로필")).toBeVisible();
    expect(screen.getByText("게시물 카테고리")).toBeVisible();
  });

  it("opens policy editing without a confirmation dialog", async () => {
    const { user } = renderRoute(() => (
      <GroupSettings group={group} categories={[]} />
    ));

    await user.click(screen.getByRole("button", { name: "게시물 작성 변경" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "게시물 작성" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("게시물 작성 저장");
  });

  it("warns when making a private group public", async () => {
    const { user } = renderRoute(() => (
      <GroupSettings
        group={{ ...group, join_policy: "invite_only" }}
        categories={[]}
      />
    ));

    await user.click(screen.getByRole("button", { name: "가입 방식 변경" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "가입 방식" }),
      "open",
    );
    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "다시 비공개로 변경할 수 없습니다",
    );
  });

  it("does not offer private mode for a public group", async () => {
    const { user } = renderRoute(() => (
      <GroupSettings group={group} categories={[]} />
    ));

    await user.click(screen.getByRole("button", { name: "가입 방식 변경" }));
    expect(
      screen.queryByRole("option", { name: "초대 전용" }),
    ).not.toBeInTheDocument();
  });

  it("keeps official group policies read-only", () => {
    renderRoute(() => (
      <GroupSettings group={{ ...group, kind: "official" }} categories={[]} />
    ));

    expect(
      screen.getByText("공식 그룹의 운영 정책은 변경할 수 없습니다."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /가입 방식 변경/ }),
    ).not.toBeInTheDocument();
  });

  it("shows managers only category management", () => {
    renderRoute(() => (
      <GroupSettings
        group={{ ...group, member_role: "manager" }}
        categories={[]}
      />
    ));

    expect(screen.queryByLabelText("그룹 이름")).not.toBeInTheDocument();
    expect(screen.getByText("게시물 카테고리")).toBeVisible();
  });

  it("keeps basic edits and values open when saving fails", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <GroupSettings group={group} categories={[]} />,
        action: () => data({ error: "저장하지 못했습니다." }, { status: 400 }),
      },
    ]);
    const user = userEvent.setup();
    render(<Stub />);

    await user.click(screen.getByRole("button", { name: "기본 정보 편집" }));
    const name = screen.getByLabelText("그룹 이름");
    await user.clear(name);
    await user.type(name, "변경한 이름");
    await user.click(screen.getByRole("button", { name: "저장" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "저장하지 못했습니다.",
    );
    expect(screen.getByLabelText("그룹 이름")).toHaveValue("변경한 이름");
  });

  it("keeps policy edits open on failure and closes them on success", async () => {
    let succeeds = false;
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => <GroupSettings group={group} categories={[]} />,
        action: () =>
          succeeds
            ? data({ ok: true })
            : data({ error: "정책을 저장하지 못했습니다." }, { status: 400 }),
      },
    ]);
    const user = userEvent.setup();
    render(<Stub />);

    await user.click(screen.getByRole("button", { name: "게시물 작성 변경" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "게시물 작성" }),
      "staff",
    );
    await user.click(screen.getByRole("button", { name: "저장" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "정책을 저장하지 못했습니다.",
    );
    expect(screen.getByRole("combobox", { name: "게시물 작성" })).toHaveValue(
      "staff",
    );

    succeeds = true;
    await user.click(screen.getByRole("button", { name: "저장" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("combobox", { name: "게시물 작성" }),
      ).not.toBeInTheDocument(),
    );
  });
});
