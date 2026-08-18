import { beforeEach, describe, expect, it, vi } from "vitest";

const { createProfilePostWithAttachments, updateProfilePostWithAttachments } =
  vi.hoisted(() => ({
    createProfilePostWithAttachments: vi.fn(),
    updateProfilePostWithAttachments: vi.fn(),
  }));

vi.mock("~/features/posts/data/mutations", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  createProfilePostWithAttachments,
  updateProfilePostWithAttachments,
}));

import { ProfilePostEditor } from "~/features/posts/components/profile-post-editor";
import { profilePost } from "../profile-post-fixture";
import { renderRoute, screen } from "../../../router";

type EditorProps = Parameters<typeof ProfilePostEditor>[0];

function renderEditor(overrides: Partial<EditorProps> = {}) {
  const props: EditorProps = {
    mode: "create",
    timelinePubId: "jieun-29",
    timelineName: "이지은",
    canChooseVisibility: true,
    ...overrides,
  };
  return renderRoute(() => <ProfilePostEditor {...props} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  createProfilePostWithAttachments.mockResolvedValue("post-id");
});

/**
 * 저장은 route action이 아니라 이 컴포넌트가 직접 돌린다(`AGENTS.md`: 파일 처리·진행률·재시도는
 * 소유 기능에 둔다). 그래서 검증도 폼 제출이 실제로 뮤테이션에 닿는지로 확인한다.
 */
describe("ProfilePostEditor", () => {
  it("본문도 첨부도 없으면 Supabase까지 보내지 않는다", async () => {
    const { user } = renderEditor();

    await user.click(screen.getByRole("button", { name: "게시" }));

    expect(createProfilePostWithAttachments).not.toHaveBeenCalled();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "본문 또는 첨부 파일을 추가해 주세요.",
    );
  });

  it("자기 타임라인에서는 공개 범위를 고른 대로 보낸다", async () => {
    const { user } = renderEditor();

    await user.type(screen.getByLabelText("Markdown 본문"), "나만 보는 메모");
    await user.selectOptions(screen.getByLabelText("공개 범위"), "private");
    await user.click(screen.getByRole("button", { name: "게시" }));

    expect(createProfilePostWithAttachments).toHaveBeenCalledWith(
      "jieun-29",
      expect.objectContaining({
        body: "나만 보는 메모",
        visibility: "private",
      }),
      [],
      expect.anything(),
      expect.any(Function),
    );
  });

  // 타인 타임라인 글은 언제나 전체 공개다(기능 명세 §8.4). 고를 수 없다는 것을 밝혀 둔다.
  it("타인 타임라인에서는 공개 범위를 고를 수 없다", async () => {
    const { user } = renderEditor({ canChooseVisibility: false });

    expect(screen.queryByLabelText("공개 범위")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "다른 사용자의 타임라인에 남기는 게시물은 전체 공개됩니다.",
      ),
    ).toBeVisible();

    await user.type(screen.getByLabelText("Markdown 본문"), "생일 축하해!");
    await user.click(screen.getByRole("button", { name: "게시" }));

    expect(createProfilePostWithAttachments).toHaveBeenCalledWith(
      "jieun-29",
      expect.objectContaining({ visibility: "public" }),
      [],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("수정에서는 공개 범위 변경만으로도 저장할 수 있다", async () => {
    updateProfilePostWithAttachments.mockResolvedValue("post-id");
    const { user } = renderEditor({
      mode: "edit",
      post: profilePost({
        body: "이미 쓴 글",
        visibility: "private",
        author_pub_id: "jieun-29",
        timeline_pub_id: "jieun-29",
      }),
    });

    await user.selectOptions(screen.getByLabelText("공개 범위"), "public");
    await user.click(screen.getByRole("button", { name: "저장" }));

    expect(updateProfilePostWithAttachments).toHaveBeenCalledWith(
      "post-id",
      { body: "이미 쓴 글", visibility: "public" },
      [],
      new Set(),
      [],
      [],
      expect.anything(),
      expect.any(Function),
    );
  });

  it("작성 화면 제목에 누구의 타임라인인지 밝힌다", () => {
    renderEditor();

    expect(screen.getByText("이지은님의 타임라인")).toBeVisible();
  });
});
