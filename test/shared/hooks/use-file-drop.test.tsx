import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useFileDrop } from "~/shared/hooks/use-file-drop";

function Harness({
  onDrop = vi.fn(),
}: {
  onDrop?: (files: FileList | null) => void;
}) {
  const { isDragging, dropHandlers } = useFileDrop(onDrop);

  return (
    <div data-testid="drop-zone" {...dropHandlers}>
      <span draggable>내부 이미지</span>
      {isDragging ? "드롭 가능" : "대기"}
    </div>
  );
}

function dataTransfer(file = new File(["x"], "photo.jpg")) {
  return {
    files: [file] as unknown as FileList,
    types: ["Files"],
  };
}

describe("useFileDrop", () => {
  it("외부 파일이 들어오면 상태를 표시하고 드롭한 파일을 넘긴다", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const transfer = dataTransfer();
    const zone = screen.getByTestId("drop-zone");

    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    expect(zone).toHaveTextContent("드롭 가능");

    fireEvent.drop(zone, { dataTransfer: transfer });
    expect(onDrop).toHaveBeenCalledWith(transfer.files);
    expect(zone).toHaveTextContent("대기");
  });

  it("문서 안에서 시작된 파일 드래그는 무시한다", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const transfer = dataTransfer();
    const zone = screen.getByTestId("drop-zone");

    fireEvent.dragStart(screen.getByText("내부 이미지"));
    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    fireEvent.drop(zone, { dataTransfer: transfer });

    expect(zone).toHaveTextContent("대기");
    expect(onDrop).not.toHaveBeenCalled();
  });

  it("자식 경계를 넘나들어도 마지막 dragleave 전까지 상태를 유지한다", () => {
    render(<Harness />);
    const transfer = dataTransfer();
    const zone = screen.getByTestId("drop-zone");

    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    fireEvent.dragLeave(zone, { dataTransfer: transfer });
    expect(zone).toHaveTextContent("드롭 가능");

    fireEvent.dragLeave(zone, { dataTransfer: transfer });
    expect(zone).toHaveTextContent("대기");
  });

  it("dragend를 놓쳐도 문서가 숨겨지면 다음 외부 드래그를 받는다", () => {
    const onDrop = vi.fn();
    render(<Harness onDrop={onDrop} />);
    const transfer = dataTransfer();
    const zone = screen.getByTestId("drop-zone");

    fireEvent.dragStart(screen.getByText("내부 이미지"));
    fireEvent(document, new Event("visibilitychange"));
    fireEvent.dragEnter(zone, { dataTransfer: transfer });
    fireEvent.drop(zone, { dataTransfer: transfer });

    expect(onDrop).toHaveBeenCalledWith(transfer.files);
  });
});
