import { describe, expect, it } from "vitest";
import { type createRoutesStub, data } from "react-router";

import { GroupSettings } from "~/features/groups/components/group-settings";
import type { GroupDetail } from "~/features/groups/model/types";
import { renderRoute, screen, userEvent, within } from "../../../router";

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

/** 삭제 확인 칸에 그대로 옮겨 적어야 하는 문구. */
const DELETION_PHRASE = `group/${group.name}`;

type StubAction = Parameters<typeof createRoutesStub>[0][number]["action"];
type User = ReturnType<typeof userEvent.setup>;

/**
 * 이 화면은 카드가 여섯 개라 한 번 그리는 것부터 비싸다. 그래서 렌더는 시나리오당 하나로 두고,
 * 같은 렌더 안에서 끝까지 확인한다.
 *
 * `delay: null`은 키 입력 사이의 타이머를 없앤다. 확인 문구를 한 글자씩 치는 동안 도는 리렌더가
 * 이 파일에서 가장 비쌌고, 문구 입력은 `paste`로 한 번에 넣는다.
 */
function renderSettings(
  overrides: Partial<GroupDetail> = {},
  {
    canDeleteOfficial = false,
    action,
  }: { canDeleteOfficial?: boolean; action?: StubAction } = {},
) {
  const view = renderRoute(
    () => (
      <GroupSettings
        group={{ ...group, ...overrides }}
        categories={[]}
        canDeleteOfficial={canDeleteOfficial}
      />
    ),
    { action },
  );

  return { ...view, user: userEvent.setup({ delay: null }) };
}

/** 편집 폼의 저장 → 확인 대화상자의 저장. 카드마다 같은 두 단계를 거친다. */
async function save(user: User) {
  await user.click(screen.getByRole("button", { name: "저장" }));
  await user.click(
    within(screen.getByRole("dialog")).getByRole("button", { name: "저장" }),
  );
}

async function fillPhrase(user: User, phrase: string) {
  const input = within(screen.getByRole("dialog")).getByLabelText(
    /group\/테스트 그룹/,
  );

  await user.click(input);
  await user.paste(phrase);

  return input;
}

describe("GroupSettings", () => {
  it("allows owners to edit basic information and policies", async () => {
    const { user } = renderSettings();

    await user.click(screen.getByRole("button", { name: "기본 정보 편집" }));
    expect(screen.getByLabelText("그룹 이름")).toHaveValue("테스트 그룹");

    await user.click(screen.getByRole("button", { name: "가입 방식 변경" }));
    const joinPolicy = screen.getByRole("combobox", { name: "가입 방식" });
    expect(joinPolicy).toHaveValue("request");
    // 이미 공개된 그룹은 되돌릴 수 없으므로 비공개는 선택지에 없다.
    expect(
      within(joinPolicy).queryByRole("option", { name: "비공개" }),
    ).not.toBeInTheDocument();

    expect(screen.getAllByRole("button", { name: "저장" })).toHaveLength(2);
    expect(screen.getByText("그룹 프로필")).toBeVisible();
    expect(screen.getByText("게시물 카테고리")).toBeVisible();
  });

  it("opens policy editing without a confirmation dialog", async () => {
    const { user } = renderSettings();

    await user.click(screen.getByRole("button", { name: "게시물 작성 변경" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "게시물 작성" })).toBeVisible();

    await user.click(screen.getByRole("button", { name: "저장" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("게시물 작성 저장");
  });

  it("offers both supported identity policies", async () => {
    const { user } = renderSettings();

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
    const { user } = renderSettings({ join_policy: "invite_only" });

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

  it("lets official groups change policies but hides deletion from their owner", () => {
    // 그룹 종류로 정책을 잠그지는 않는다. 남는 제약은 지금 그룹의 상태에서만 나온다.
    // 삭제만 다르다 — 공식 그룹은 앱 관리자만 지운다.
    renderSettings({ kind: "official" });

    expect(
      screen.getByRole("button", { name: "가입 방식 변경" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "활동 신원 변경" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "그룹 삭제" }),
    ).not.toBeInTheDocument();
  });

  it("keeps group deletion out of reach for everyone but the owner", () => {
    // 관리자에게도 열어 주면 소유자가 모르는 사이에 그룹이 사라진다. 소유자에게 보인다는 것은
    // 아래 삭제 확인 테스트가 실제로 눌러 보며 함께 확인한다.
    renderSettings({ member_role: "admin" });

    expect(
      screen.queryByRole("button", { name: "그룹 삭제" }),
    ).not.toBeInTheDocument();
  });

  it("requires a second confirmation before deleting an official group", async () => {
    const { user } = renderSettings(
      { kind: "official", member_role: "member" },
      { canDeleteOfficial: true },
    );

    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));
    await fillPhrase(user, DELETION_PHRASE);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "영구 삭제",
      }),
    );

    const officialConfirmation = screen.getByRole("dialog");
    expect(officialConfirmation).toHaveTextContent(
      "이 작업은 되돌릴 수 없습니다.",
    );
    expect(
      within(officialConfirmation).getByRole("button", {
        name: "공식 그룹 삭제",
      }),
    ).toBeVisible();
  });

  it("holds the deletion until the group name is written back, and forgets it on dismissal", async () => {
    // 버튼을 한 번 더 누르는 확인은 습관이 되지만, 옮겨 적는 동안에는 어느 그룹을 지우는지
    // 눈으로 확인할 수밖에 없다.
    const { user } = renderSettings();

    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));
    const confirm = within(screen.getByRole("dialog")).getByRole("button", {
      name: "영구 삭제",
    });
    expect(confirm).toBeDisabled();

    const input = await fillPhrase(user, "group/다른 그룹");
    expect(confirm).toBeDisabled();

    await user.clear(input);
    await user.paste(DELETION_PHRASE);
    expect(confirm).toBeEnabled();

    // 닫으면 입력한 문구도 함께 사라진다. 남아 있으면 다시 열었을 때 확인이 무의미해진다.
    await user.click(screen.getByRole("button", { name: "취소" }));
    await user.click(screen.getByRole("button", { name: "그룹 삭제" }));

    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "영구 삭제",
      }),
    ).toBeDisabled();
  });

  it("shows managers only category management", () => {
    renderSettings({ member_role: "manager" });

    expect(screen.queryByLabelText("그룹 이름")).not.toBeInTheDocument();
    expect(screen.getByText("게시물 카테고리")).toBeVisible();
  });

  it("keeps basic edits and values open when saving fails", async () => {
    const { user } = renderSettings(
      {},
      {
        action: () => data({ error: "저장하지 못했습니다." }, { status: 400 }),
      },
    );

    await user.click(screen.getByRole("button", { name: "기본 정보 편집" }));
    await user.clear(screen.getByLabelText("그룹 이름"));
    await user.paste("변경한 이름");
    await save(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "저장하지 못했습니다.",
    );
    expect(screen.getByLabelText("그룹 이름")).toHaveValue("변경한 이름");
  });

  it("keeps policy edits open on failure and closes them on success", async () => {
    let succeeds = false;
    const { user } = renderSettings(
      {},
      {
        action: () =>
          succeeds
            ? data({ ok: true })
            : data({ error: "정책을 저장하지 못했습니다." }, { status: 400 }),
      },
    );

    await user.click(screen.getByRole("button", { name: "게시물 작성 변경" }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: "게시물 작성" }),
      "staff",
    );
    await save(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "정책을 저장하지 못했습니다.",
    );
    expect(screen.getByRole("combobox", { name: "게시물 작성" })).toHaveValue(
      "staff",
    );

    succeeds = true;
    await save(user);

    // 저장에 성공하면 편집 폼이 닫히고 '변경' 버튼이 돌아온다.
    expect(
      await screen.findByRole("button", { name: "게시물 작성 변경" }),
    ).toBeVisible();
  });
});
