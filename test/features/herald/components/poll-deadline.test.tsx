import { act, fireEvent } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HeraldScreen } from "~/features/herald/components/herald-screen";
import { ContentEditor } from "~/features/herald/components/editor-dialogs";
import { renderRoute, screen, within } from "../../../router";

const viewer = {
  id: 1,
  pubId: "student",
  name: "홍길동",
  type: "student" as const,
  role: "member" as const,
};

afterEach(() => vi.useRealTimers());

describe("Herald poll deadline", () => {
  it("does not reopen a poll when its deadline passes while the editor is open", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-05T02:59:00Z"));
    renderRoute(() => <HeraldScreen viewer={viewer} />);
    fireEvent.click(screen.getByRole("button", { name: "Editor access" }));
    fireEvent.change(screen.getByLabelText("Herald password"), {
      target: { value: "herald-preview" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Create poll" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Deadline during editing" },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "Yes\nNo" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Close automatically" }),
    );
    fireEvent.change(screen.getByLabelText("Closing date (KST)"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish demo" }));
    fireEvent.click(screen.getByRole("button", { name: "Editorial desk" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Deadline during editing" }),
    );
    fireEvent.change(screen.getByLabelText("Hour"), {
      target: { value: "1" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(screen.getByRole("alert")).toHaveTextContent("This poll has closed");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.click(screen.getByRole("button", { name: "Editorial desk" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Edit Deadline during editing" }),
    );
    expect(screen.getByLabelText("Hour")).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Corrected question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    fireEvent.click(
      screen.getByRole("button", { name: "View poll: Corrected question" }),
    );
    const result = within(
      screen.getByRole("dialog", { name: "Corrected question" }),
    );
    expect(result.getByText("Poll closed")).toBeVisible();
    fireEvent.click(result.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity history" }));
    expect(screen.getByText("Fields: title")).toBeVisible();
  });
  it("interprets 12 AM as midnight in KST and rejects a closing time that has already passed", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-05T14:59:00Z"));
    const save = vi.fn();
    renderRoute(() => (
      <ContentEditor
        target={{ kind: "Poll" }}
        fileUrl={vi.fn()}
        onClose={vi.fn()}
        onSave={save}
      />
    ));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Midnight poll" },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "Yes\nNo" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Close automatically" }),
    );
    fireEvent.change(screen.getByLabelText("Closing date (KST)"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.change(screen.getByLabelText("AM/PM"), {
      target: { value: "AM" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish demo" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Choose a closing time in the future",
    );
    expect(save).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Closing date (KST)"), {
      target: { value: "2026-11-06" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish demo" }));
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "Poll",
        item: expect.objectContaining({ closesAt: "2026-11-05T15:00:00.000Z" }),
      }),
    );
  });
  it("closes at the chosen KST time and keeps the result in the archive without crediting the reader for automatic closure", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    vi.setSystemTime(new Date("2026-11-05T02:59:30Z")); // 11:59:30 AM KST.
    renderRoute(() => <HeraldScreen viewer={viewer} />);
    fireEvent.click(screen.getByRole("button", { name: "Editor access" }));
    fireEvent.change(screen.getByLabelText("Herald password"), {
      target: { value: "herald-preview" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Unlock editor" }));
    fireEvent.click(screen.getByRole("button", { name: "Create poll" }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: "Lunch deadline" },
    });
    fireEvent.change(screen.getByLabelText("Choices, one per line"), {
      target: { value: "Option A\nOption B" },
    });
    fireEvent.click(
      screen.getByRole("switch", { name: "Close automatically" }),
    );
    fireEvent.change(screen.getByLabelText("Closing date (KST)"), {
      target: { value: "2026-11-05" },
    });
    fireEvent.change(screen.getByLabelText("Hour"), {
      target: { value: "12" },
    });
    fireEvent.change(screen.getByLabelText("Minute"), {
      target: { value: "00" },
    });
    fireEvent.change(screen.getByLabelText("AM/PM"), {
      target: { value: "PM" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish demo" }));
    const poll = within(screen.getByRole("region", { name: "Lunch deadline" }));
    expect(poll.getByText(/12:00 PM KST/)).toBeVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(29_999);
    });
    expect(poll.getByRole("button", { name: "Vote" })).toBeVisible();
    fireEvent.click(poll.getByRole("radio", { name: "Option A" }));
    // The wall clock can reach the deadline before a background timer gets to run.
    vi.setSystemTime(new Date("2026-11-05T03:00:00Z"));
    fireEvent.click(poll.getByRole("button", { name: "Vote" }));
    expect(poll.queryByText(/demo votes/)).not.toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      screen.queryByRole("region", { name: "Lunch deadline" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "View poll: Lunch deadline" }),
    );
    const result = within(
      screen.getByRole("dialog", { name: "Lunch deadline" }),
    );
    expect(result.getByText("Poll closed")).toBeVisible();
    expect(result.getByText("0 demo votes")).toBeVisible();
    expect(result.getByRole("radio", { name: "Option A" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    fireEvent.click(result.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Activity history" }));
    const history = within(
      screen.getByRole("dialog", { name: "Activity history" }),
    );
    expect(history.getByText(/Fields:.*closesAt/)).toBeVisible();
    expect(
      history.queryByText("Closed", { exact: true }),
    ).not.toBeInTheDocument();
  });
});
