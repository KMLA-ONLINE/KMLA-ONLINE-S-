import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useImageCrop } from "~/shared/hooks/use-image-crop";

let counter: number;
const createObjectUrl = vi.fn(() => `blob:test/${++counter}`);
const revokeObjectUrl = vi.fn();

function Harness({ onCropped }: { onCropped: (file: File) => void }) {
  const { start, cropperProps } = useImageCrop(onCropped);

  return (
    <div>
      <button onClick={() => start(new File(["x"], "photo.jpg"))}>열기</button>
      <button
        onClick={() => {
          start(new File(["a"], "a.jpg"));
          start(new File(["b"], "b.jpg"));
        }}
      >
        한 번에 두 번 열기
      </button>
      {cropperProps ? (
        <div>
          <span data-testid="preview">{cropperProps.previewUrl}</span>
          <button onClick={cropperProps.onCancel}>취소</button>
          <button
            onClick={() => cropperProps.onComplete(new File(["y"], "c.png"))}
          >
            적용
          </button>
        </div>
      ) : null}
    </div>
  );
}

describe("useImageCrop", () => {
  beforeEach(() => {
    counter = 0;
    createObjectUrl.mockClear();
    revokeObjectUrl.mockClear();
    // jsdom은 두 API 모두 구현하지 않는다.
    URL.createObjectURL = createObjectUrl;
    URL.revokeObjectURL = revokeObjectUrl;
  });

  it("파일을 고르기 전에는 cropperProps가 없고 URL도 만들지 않는다", () => {
    render(<Harness onCropped={vi.fn()} />);

    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    expect(createObjectUrl).not.toHaveBeenCalled();
  });

  it("start하면 미리보기 URL을 한 번 만든다", async () => {
    render(<Harness onCropped={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "열기" }));

    expect(screen.getByTestId("preview")).toHaveTextContent("blob:test/1");
    expect(createObjectUrl).toHaveBeenCalledOnce();
    expect(revokeObjectUrl).not.toHaveBeenCalled();
  });

  it("취소하면 URL을 해제하고 다이얼로그를 닫는다", async () => {
    render(<Harness onCropped={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "열기" }));
    await userEvent.click(screen.getByRole("button", { name: "취소" }));

    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith("blob:test/1");
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });

  it("적용하면 잘린 파일을 넘기고 URL을 해제한다", async () => {
    const onCropped = vi.fn();
    render(<Harness onCropped={onCropped} />);

    await userEvent.click(screen.getByRole("button", { name: "열기" }));
    await userEvent.click(screen.getByRole("button", { name: "적용" }));

    expect(onCropped).toHaveBeenCalledOnce();
    expect(onCropped.mock.calls[0][0]).toBeInstanceOf(File);
    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith("blob:test/1");
  });

  it("다른 파일로 다시 열면 이전 URL을 해제한다", async () => {
    render(<Harness onCropped={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "열기" }));
    await userEvent.click(screen.getByRole("button", { name: "열기" }));

    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith("blob:test/1");
    expect(screen.getByTestId("preview")).toHaveTextContent("blob:test/2");
  });

  it("같은 배치에서 두 번 열어도 중간 URL이 새지 않는다", async () => {
    // start(A)와 start(B)가 한 배치에 묶이면 A는 상태로 커밋되지 못한다. 해제를 이펙트
    // cleanup에만 맡기면 cleanup이 커밋된 값만 보므로 A의 URL은 영원히 남고, 그 blob이
    // 붙잡은 파일 전체가 새로고침까지 메모리에 남는다.
    render(<Harness onCropped={vi.fn()} />);

    await userEvent.click(
      screen.getByRole("button", { name: "한 번에 두 번 열기" }),
    );

    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith("blob:test/1");
    expect(screen.getByTestId("preview")).toHaveTextContent("blob:test/2");
  });

  it("열린 채로 언마운트되면 URL을 해제한다", async () => {
    const view = render(<Harness onCropped={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "열기" }));
    act(() => {
      view.unmount();
    });

    expect(revokeObjectUrl).toHaveBeenCalledExactlyOnceWith("blob:test/1");
  });
});
