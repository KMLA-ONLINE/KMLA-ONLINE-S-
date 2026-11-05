import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ContentEditor } from "~/features/herald/components/editor-dialogs";
import { renderRoute, screen } from "../../../router";

describe("Herald story photos", () => {
  it("accepts a pasted image while preserving ordinary text paste and file validation", async () => {
    const save = vi.fn();
    const fileUrl = vi.fn(() => "blob:pasted-photo");
    const { user } = renderRoute(() => (
      <ContentEditor
        target={{ kind: "Story" }}
        onSave={save}
        onClose={vi.fn()}
        fileUrl={fileUrl}
      />
    ));
    await user.click(screen.getByLabelText("Title"));
    await user.paste("A pasted story");
    await user.type(screen.getByLabelText("Story text"), "Student reporting.");
    fireEvent.paste(screen.getByLabelText("Story text"), {
      clipboardData: {
        files: [new File(["gif"], "image.gif", { type: "image/gif" })],
      },
    });
    await user.click(screen.getByRole("button", { name: "Publish demo" }));
    expect(screen.getByRole("alert")).toHaveTextContent("JPEG, PNG, or WebP");
    expect(save).not.toHaveBeenCalled();
    const photo = new File(["png"], "clipboard.png", { type: "image/png" });
    fireEvent.paste(screen.getByLabelText("Story text"), {
      clipboardData: { files: [photo] },
    });
    expect(screen.getByRole("status")).toHaveTextContent("clipboard.png");
    await user.click(screen.getByRole("button", { name: "Publish demo" }));
    expect(fileUrl).toHaveBeenCalledWith(photo);
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "Story",
        item: expect.objectContaining({
          title: "A pasted story",
          body: "Student reporting.",
          image: "blob:pasted-photo",
        }),
      }),
    );
  });
});
