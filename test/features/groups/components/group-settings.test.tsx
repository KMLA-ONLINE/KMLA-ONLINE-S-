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

  it("offers both supported identity policies", async () => {
    const { user } = renderRoute(() => (
      <GroupSettings group={group} categories={[]} />
    ));

    await user.click(screen.getByRole("button", { name: "활동 신원 변경" }));
    const select = screen.getByRole("combobox", { name: "활동 신원" });
    expect(
      within(select).getByRole("option", { name: "실명만" }),
    ).toBeVisible();
    expect(
      within(select).getByRole("option", { name: "작성할 때 선택" }),
    ).toBeVisible();
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

  it("lets official groups change their policies too", () => {
    // 그룹 종류로 잠그지 않는다. 남는 제약은 지금 그룹의 상태에서만 나온다.
    renderRoute(() => (
      <GroupSettings group={{ ...group, kind: "official" }} categories={[]} />
    ));

    expect(
      screen.getByRole("button", { name: "가입 방식 변경" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "활동 신원 변경" }),
    ).toBeVisible();
  });

  it("keeps group deletion out of reach for everyone but the owner", () => {
    // 관리자에게도 열어 주면 소유자가 모르는 사이에 그룹이 사라진다.
    const { unmount } = renderRoute(() => (
      <GroupSettings
        group={{ ...group, member_role: "admin" }}
        categories={[]}
      />
    ));

    expect(
      screen.queryByRole("button", { name: "그룹 삭제" }),
    ).not.toBeInTheDocument();
    unmount();

    renderRoute(() => <GroupSettings group={group} categories={[]} />);

    expect(screen.getByRole("button", { name: "그룹 삭제" })).toBeVisible();
  });

  it("offers official-group deletion only to app administrators", () => {
    renderRoute(() => (
      <GroupSettings group={{ ...group, kind: "official" }} categories={[]} />
    ));

    expect(
      screen.queryByRole("button", { name: "그룹 삭제" }),
    ).not.toBeInTheDocument();
  });

  it("requires a second confirmation before deleting an official group", async () => {
    const { user } = renderRoute(() => (
      <GroupSettings
        group={{ ...group, kind: "official", member_role: "member" }}
        categories={[]}
        canDeleteOfficial
      />
    ));

    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));
    const firstConfirmation = screen.getByRole("dialog");
    await user.type(
      within(firstConfirmation).getByLabelText(/group\/테스트 그룹/),
      "group/테스트 그룹",
    );
    await user.click(
      within(firstConfirmation).getByRole("button", { name: "영구 삭제" }),
    );

    const officialConfirmation = screen.getByRole("dialog");
    expect(officialConfirmation).toHaveTextContent(
      "자동 가입된 재학생과 모든 콘텐츠가 영구 삭제됩니다.",
    );
    expect(
      within(officialConfirmation).getByRole("button", {
        name: "공식 그룹 삭제",
      }),
    ).toBeVisible();
  });

  it("holds the deletion until the group name is typed back", async () => {
    // 버튼을 한 번 더 누르는 확인은 습관이 되지만, 옮겨 적는 동안에는 어느 그룹을 지우는지
    // 눈으로 확인할 수밖에 없다.
    const { user } = renderRoute(() => (
      <GroupSettings group={group} categories={[]} />
    ));

    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "영구 삭제" });
    expect(confirm).toBeDisabled();

    const input = within(dialog).getByLabelText(/group\/테스트 그룹/);
    await user.type(input, "group/다른 그룹");
    expect(confirm).toBeDisabled();

    await user.clear(input);
    await user.type(input, "group/테스트 그룹");
    expect(confirm).toBeEnabled();
  });

  it("forgets what was typed when the dialog is dismissed", async () => {
    const { user } = renderRoute(() => (
      <GroupSettings group={group} categories={[]} />
    ));

    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));
    await user.type(
      within(screen.getByRole("dialog")).getByLabelText(/group\//),
      "group/테스트 그룹",
    );
    await user.click(screen.getByRole("button", { name: "취소" }));

    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "영구 삭제",
      }),
    ).toBeDisabled();
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
