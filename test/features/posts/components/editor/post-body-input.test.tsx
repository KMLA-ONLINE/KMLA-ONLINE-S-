import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PostBodyInput,
  type PostBodyInputHandle,
} from "~/features/posts/components/editor/post-body-input";

const { insertMention } = vi.hoisted(() => ({ insertMention: vi.fn() }));
const matchMedia = vi.fn();

vi.mock(
  "~/features/posts/components/editor/desktop-markdown-editor",
  async () => {
    const { useImperativeHandle } = await import("react");
    function MockMarkdownEditor({
      initialValue,
      handleRef,
      className,
    }: {
      initialValue: string;
      handleRef?: React.RefObject<PostBodyInputHandle | null>;
      className?: string;
    }) {
      useImperativeHandle(handleRef, () => ({ insertMention }));
      return (
        <div aria-label="Milkdown 본문" className={className}>
          {initialValue}
        </div>
      );
    }
    return {
      default: MockMarkdownEditor,
    };
  },
);

beforeEach(() => {
  insertMention.mockClear();
  Object.defineProperty(window, "matchMedia", {
    value: matchMedia,
    configurable: true,
  });
});

function InputWithExternalHandle() {
  const handle = useRef<PostBodyInputHandle>(null);
  return (
    <>
      <PostBodyInput
        value="**서식 본문**"
        handleRef={handle}
        className="flex-1"
      />
      <button
        type="button"
        onClick={() => handle.current?.insertMention("한별", 7)}
      >
        멘션 넣기
      </button>
    </>
  );
}

describe("PostBodyInput", () => {
  it.each([
    ["mobile", false],
    ["desktop", true],
  ])("routes the external handle to Milkdown on %s", async (_name, desktop) => {
    matchMedia.mockReturnValue({ matches: desktop });
    const user = userEvent.setup();
    render(<InputWithExternalHandle />);

    expect(await screen.findByLabelText("Milkdown 본문")).toHaveTextContent(
      "**서식 본문**",
    );
    expect(screen.getByLabelText("Milkdown 본문")).toHaveClass("flex-1");
    await user.click(screen.getByRole("button", { name: "멘션 넣기" }));

    expect(insertMention).toHaveBeenCalledWith("한별", 7);
  });
});
