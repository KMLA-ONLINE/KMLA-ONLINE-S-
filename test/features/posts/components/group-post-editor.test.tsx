import { beforeEach, describe, expect, it, vi } from "vitest";

const { createGroupPostWithAttachments, updateGroupPostWithAttachments } =
  vi.hoisted(() => ({
    createGroupPostWithAttachments: vi.fn(),
    updateGroupPostWithAttachments: vi.fn(),
  }));

vi.mock("~/features/posts/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createGroupPostWithAttachments,
  updateGroupPostWithAttachments,
}));

import { GroupPostOverlay } from "~/features/posts/components/group-post-overlay";
import { renderRoute, screen } from "../../../router";

type OverlayProps = Parameters<typeof GroupPostOverlay>[0];

function renderEditor(overrides: Partial<OverlayProps> = {}) {
  const props: OverlayProps = {
    mode: "create",
    slug: "test",
    groupName: "테스트 그룹",
    groupId: "group-id",
    categories: [],
    identities: ["identified"],
    ...overrides,
  };
  return renderRoute(() => <GroupPostOverlay {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  createGroupPostWithAttachments.mockResolvedValue("post-id");
});

/**
 * 저장은 route action이 아니라 이 컴포넌트가 직접 돌린다(`AGENTS.md`: 파일 처리·진행률·재시도는
 * 소유 기능에 둔다). 그래서 검증도 폼 제출이 실제로 뮤테이션에 닿는지로 확인한다 — action을
 * 따로 시험하면 제출이 그 action에 닿지 않아도 초록불이 켜진다.
 */
describe("GroupPostOverlay 저장 경로", () => {
  it("공백뿐인 제목을 Supabase까지 보내지 않는다", async () => {
    // 빈 제목은 `required`가 브라우저 단에서 막는다. 공백만 채운 제목은 통과하므로 여기서부터가
    // `validatePostForm`의 몫이다.
    const { user } = renderEditor();

    await user.type(screen.getByLabelText("제목"), "   ");
    await user.type(screen.getByLabelText("Markdown 본문"), "본문");
    await user.click(screen.getByRole("button", { name: "게시" }));

    expect(createGroupPostWithAttachments).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "제목을 입력해 주세요.",
    );
  });

  it("폼 제출이 뮤테이션까지 닿는다", async () => {
    const { user } = renderEditor();

    await user.type(screen.getByLabelText("제목"), "제목");
    await user.type(screen.getByLabelText("Markdown 본문"), "본문");
    await user.click(screen.getByRole("button", { name: "게시" }));

    await vi.waitFor(() =>
      expect(createGroupPostWithAttachments).toHaveBeenCalledWith(
        "group-id",
        expect.objectContaining({
          title: "제목",
          body: "본문",
          authorIdentity: "identified",
        }),
        [],
        expect.anything(),
        expect.anything(),
      ),
    );
  });

  it("고를 수 없는 신원이 폼에 실려 와도 실명으로 떨어뜨린다", async () => {
    // 폼 값은 DOM에서 온다. `readPostForm`의 화이트리스트가 유일한 경계다.
    const { user } = renderEditor({ identities: ["identified", "anonymous"] });
    const identity = screen.getByLabelText<HTMLSelectElement>("작성 신원");
    identity.insertAdjacentHTML(
      "beforeend",
      '<option value="staff">운영진</option>',
    );
    await user.selectOptions(identity, "staff");

    await user.type(screen.getByLabelText("제목"), "제목");
    await user.type(screen.getByLabelText("Markdown 본문"), "본문");
    await user.click(screen.getByRole("button", { name: "게시" }));

    expect(createGroupPostWithAttachments).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "선택할 수 없는 작성 신원입니다.",
    );
  });
});
