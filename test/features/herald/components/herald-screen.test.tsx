import { describe, expect, it } from "vitest";

import { HeraldScreen } from "~/features/herald/components/herald-screen";
import { renderRoute, screen, within } from "../../../router";

const viewer = {
  id: 1,
  pubId: "student",
  name: "홍길동",
  type: "student" as const,
  role: "member" as const,
};

describe("Herald reading experience", () => {
  it.each(["teacher", "alumni"] as const)(
    "keeps a %s reader out of editor and history controls",
    (type) => {
      renderRoute(() => <HeraldScreen viewer={{ ...viewer, type }} />);
      expect(
        screen.queryByRole("button", { name: "Editor access" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Activity history" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Manage password" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Read 70th edition" }),
      ).toBeVisible();
    },
  );
  it("lets an unlocked editor close a poll, revealing results and stopping further votes", async () => {
    const { user } = renderRoute(() => <HeraldScreen viewer={viewer} />);
    await user.click(screen.getByRole("button", { name: "Editor access" }));
    await user.type(screen.getByLabelText("Herald password"), "herald-preview");
    await user.click(screen.getByRole("button", { name: "Unlock editor" }));
    await user.click(screen.getByRole("button", { name: "Close poll" }));
    await user.click(screen.getByRole("button", { name: "Close voting" }));
    await user.click(
      screen.getByRole("button", {
        name: "View poll: What should we cover next?",
      }),
    );
    expect(screen.getByText("91 demo votes")).toBeVisible();
    expect(screen.getByText("Poll closed")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Vote" }),
    ).not.toBeInTheDocument();
  });

  it("allows admin history access and password changes that lock the editor without logging the password", async () => {
    const { user } = renderRoute(() => (
      <HeraldScreen viewer={{ ...viewer, role: "admin" }} />
    ));
    await user.click(screen.getByRole("button", { name: "Activity history" }));
    expect(screen.getByText("No changes in this preview yet.")).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    await user.click(screen.getByRole("button", { name: "Editor access" }));
    await user.type(screen.getByLabelText("Herald password"), "herald-preview");
    await user.click(screen.getByRole("button", { name: "Unlock editor" }));
    await user.click(screen.getByRole("button", { name: "Manage password" }));
    await user.type(
      screen.getByLabelText("New demo password"),
      "replacement-demo",
    );
    await user.type(
      screen.getByLabelText("Confirm demo password"),
      "replacement-demo",
    );
    await user.click(screen.getByRole("button", { name: "Change password" }));
    expect(
      screen.queryByRole("button", { name: "New story" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editor access" }));
    await user.type(screen.getByLabelText("Herald password"), "herald-preview");
    await user.click(screen.getByRole("button", { name: "Unlock editor" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Incorrect demo password",
    );
    await user.clear(screen.getByLabelText("Herald password"));
    await user.type(
      screen.getByLabelText("Herald password"),
      "replacement-demo",
    );
    await user.click(screen.getByRole("button", { name: "Unlock editor" }));
    await user.click(screen.getByRole("button", { name: "Activity history" }));
    const history = within(
      screen.getByRole("dialog", { name: "Activity history" }),
    );
    expect(history.getByText("Changed password")).toBeVisible();
    expect(history.queryByText("replacement-demo")).not.toBeInTheDocument();
  });
  it("unlocks a student editor and records create, edit, and delete without content backups", async () => {
    const { user } = renderRoute(() => <HeraldScreen viewer={viewer} />);
    expect(
      screen.queryByRole("button", { name: "Activity history" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Editor access" }));
    await user.type(screen.getByLabelText("Herald password"), "wrong");
    await user.click(screen.getByRole("button", { name: "Unlock editor" }));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Incorrect demo password",
    );
    await user.clear(screen.getByLabelText("Herald password"));
    await user.type(screen.getByLabelText("Herald password"), "herald-preview");
    await user.click(screen.getByRole("button", { name: "Unlock editor" }));
    await user.click(screen.getByRole("button", { name: "New story" }));
    await user.type(screen.getByLabelText("Title"), "A student newsroom");
    await user.type(
      screen.getByLabelText("Story text"),
      "A body that must never be stored in history.",
    );
    await user.click(screen.getByRole("button", { name: "Publish demo" }));
    expect(
      screen.getByRole("button", { name: "Read: A student newsroom" }),
    ).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Editorial desk" }));
    await user.click(
      screen.getByRole("button", { name: "Edit A student newsroom" }),
    );
    await user.clear(screen.getByLabelText("Title"));
    await user.type(screen.getByLabelText("Title"), "Our student newsroom");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await user.click(screen.getByRole("button", { name: "Editorial desk" }));
    await user.click(
      screen.getByRole("button", { name: "Delete Our student newsroom" }),
    );
    await user.click(screen.getByRole("button", { name: "Delete item" }));
    expect(
      screen.queryByRole("button", { name: "Read: Our student newsroom" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Activity history" }));
    const history = within(
      screen.getByRole("dialog", { name: "Activity history" }),
    );
    expect(history.getByText("Created")).toBeVisible();
    expect(history.getByText("Edited")).toBeVisible();
    expect(history.getByText("Deleted")).toBeVisible();
    expect(history.getAllByRole("link", { name: "홍길동" })).toHaveLength(3);
    expect(
      history.queryByText("A body that must never be stored in history."),
    ).not.toBeInTheDocument();
    expect(
      history.queryByRole("button", { name: /restore/i }),
    ).not.toBeInTheDocument();
  });
  it("hides totals until voting and moves the same vote between choices across layouts", async () => {
    const { user } = renderRoute(() => <HeraldScreen viewer={viewer} />);
    const poll = within(
      screen.getByRole("region", { name: "What should we cover next?" }),
    );
    expect(poll.queryByText(/demo votes/)).not.toBeInTheDocument();
    await user.click(poll.getByRole("radio", { name: "Everyday campus life" }));
    await user.click(poll.getByRole("button", { name: "Vote" }));
    expect(poll.getByText("92 demo votes")).toBeVisible();
    await user.click(
      poll.getByRole("radio", { name: "People & their stories" }),
    );
    await user.click(poll.getByRole("button", { name: "Change vote" }));
    expect(poll.getByText("92 demo votes")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "Magazine" }));
    expect(
      screen.getByRole("radio", { name: "People & their stories" }),
    ).toBeChecked();
    expect(screen.getByText("92 demo votes")).toBeVisible();
  });
  it("opens the same story from both layouts and provides the supplied edition", async () => {
    const { user } = renderRoute(() => <HeraldScreen viewer={viewer} />);
    expect(screen.getByRole("tab", { name: "Classic" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const title = "The stories we carry beyond the classroom";
    await user.click(screen.getByRole("button", { name: `Read: ${title}` }));
    expect(screen.getByRole("dialog", { name: title })).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    await user.click(screen.getByRole("tab", { name: "Magazine" }));
    await user.click(screen.getByRole("button", { name: `Read: ${title}` }));
    expect(screen.getByRole("dialog", { name: title })).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    await user.click(screen.getByRole("button", { name: "Read 70th edition" }));
    expect(
      screen.getByRole("link", { name: "Open PDF in new tab" }),
    ).toHaveAttribute("href", "/herald/70th-edition.pdf");
  });
});
