import { describe, expect, it, vi } from "vitest";

import { EditionShelf } from "~/features/herald/components/edition-shelf";
import type { HeraldEdition } from "~/features/herald/model/types";
import { renderRoute, screen, within } from "../../../router";

const editions: HeraldEdition[] = [
  { id: "75", issue: "75th", title: "Latest", season: "2026", pdf: "/75.pdf" },
  { id: "74", issue: "74th", title: "Autumn", season: "2025", pdf: "/74.pdf" },
  { id: "73", issue: "73rd", title: "Spring", season: "2025", pdf: "/73.pdf" },
  { id: "72", issue: "72nd", title: "Winter", season: "2024", pdf: "/72.pdf" },
  { id: "71", issue: "71st", title: "Summer", season: "2024", pdf: "/71.pdf" },
  {
    id: "70",
    issue: "70th",
    title: "Life in the Screen",
    season: "2024",
    pdf: "/70.pdf",
  },
];

describe("Herald edition archive", () => {
  it("shows four recent past editions and lets a reader open an older edition from the full list", async () => {
    const onRead = vi.fn();
    const { user } = renderRoute(() => (
      <EditionShelf editions={editions} onRead={onRead} />
    ));
    expect(
      screen.getByRole("button", { name: "Read 75th edition" }),
    ).toBeVisible();
    for (const issue of ["74th", "73rd", "72nd", "71st"]) {
      expect(
        screen.getByRole("button", { name: `Read ${issue} edition` }),
      ).toBeVisible();
    }
    expect(
      screen.queryByRole("button", { name: "Read 70th edition" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "View all editions" }));
    const archive = within(
      screen.getByRole("dialog", { name: "Edition archive" }),
    );
    expect(
      archive.getAllByRole("button", { name: /^Read .* edition$/ }),
    ).toHaveLength(6);
    await user.click(
      archive.getByRole("button", { name: "Read 70th edition" }),
    );
    expect(onRead).toHaveBeenCalledWith(editions[5]);
    expect(
      screen.queryByRole("dialog", { name: "Edition archive" }),
    ).not.toBeInTheDocument();
  });
});
