import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ReleaseNotesScreen } from "~/features/support/components/release-notes-screen";
import type { Release } from "~/features/support";

const releases: Release[] = [
  {
    date: "2026-01-02",
    title: "먼저 쓴 항목",
    changes: [{ kind: "fixed", text: "버그를 고쳤습니다." }],
  },
  {
    date: "2026-08-31",
    version: "1.2.0",
    title: "나중에 쓴 항목",
    changes: [
      { kind: "added", text: "기능을 추가했습니다." },
      { kind: "deleted", text: "쓰지 않는 화면을 없앴습니다." },
    ],
  },
];

describe("ReleaseNotesScreen", () => {
  it("puts the newest release first even when the content file is out of order", () => {
    render(<ReleaseNotesScreen releases={releases} />);

    const titles = screen
      .getAllByRole("heading", { level: 2 })
      .map((heading) => heading.textContent);

    expect(titles).toEqual(["나중에 쓴 항목", "먼저 쓴 항목"]);
  });

  it("reads a calendar date as itself rather than shifting it by timezone", () => {
    render(<ReleaseNotesScreen releases={releases} />);

    expect(screen.getByText("2026년 8월 31일")).toBeInTheDocument();
    expect(screen.getByText("2026년 1월 2일")).toBeInTheDocument();
  });

  it("labels each change by kind and shows a version only when one is given", () => {
    render(<ReleaseNotesScreen releases={releases} />);

    // `listitem`으로 잡으면 변경 줄까지 딸려 온다. 릴리스 한 건은 `article`이다.
    const [newest, oldest] = screen.getAllByRole("article");

    expect(within(newest).getByText("1.2.0")).toBeInTheDocument();
    expect(within(newest).getByText("추가")).toBeInTheDocument();
    expect(within(newest).getByText("제거")).toBeInTheDocument();
    expect(within(oldest).getByText("수정")).toBeInTheDocument();
  });

  it("shows an empty state before the first release is logged", () => {
    render(<ReleaseNotesScreen releases={[]} />);

    expect(
      screen.getByText("아직 기록된 업데이트가 없어요"),
    ).toBeInTheDocument();
  });
});
