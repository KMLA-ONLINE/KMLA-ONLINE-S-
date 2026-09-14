import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PostBodyInput,
  type PostBodyInputHandle,
} from "~/features/posts/components/editor/post-body-input";

const { insertMention } = vi.hoisted(() => ({ insertMention: vi.fn() }));

vi.mock(
  "~/features/posts/components/editor/desktop-markdown-editor",
  async () => {
    const { useImperativeHandle } = await import("react");
    function MockMarkdownEditor({
      initialValue,
      handleRef,
    }: {
      initialValue: string;
      handleRef?: React.RefObject<PostBodyInputHandle | null>;
    }) {
      useImperativeHandle(handleRef, () => ({ insertMention }));
      return <div aria-label="Milkdown 본문">{initialValue}</div>;
    }
    return { default: MockMarkdownEditor };
  },
);

beforeEach(() => insertMention.mockClear());

function InputWithExternalHandle() {
  const handle = useRef<PostBodyInputHandle>(null);
  return (
    <>
      <PostBodyInput value="**서식 본문**" handleRef={handle} />
      <button
        type="button"
        onClick={() => handle.current?.insertMention("한별", 7)}
      >
        멘션 넣기
      </button>
    </>
  );
}

/**
 * `handleRef`는 optional이라 전달을 빠뜨려도 타입 검사에 걸리지 않는다. 끊기면 멘션 버튼이
 * 아무 일도 하지 않는 채로 조용히 남는다 — `group-post-editor.tsx`는 이 손잡이로만 커서
 * 자리에 토큰을 넣고, 그 경로를 붙잡는 테스트는 여기뿐이다.
 */
describe("PostBodyInput", () => {
  it("routes the external handle to the lazy editor", async () => {
    const user = userEvent.setup();
    render(<InputWithExternalHandle />);

    expect(await screen.findByLabelText("Milkdown 본문")).toHaveTextContent(
      "**서식 본문**",
    );
    await user.click(screen.getByRole("button", { name: "멘션 넣기" }));

    expect(insertMention).toHaveBeenCalledWith("한별", 7);
  });
});
