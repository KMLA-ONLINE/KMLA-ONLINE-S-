import { afterEach, describe, expect, it } from "vitest";

import { SchoolNoticeDetailScreen } from "~/features/school-notices/components/school-notice-detail-screen";
import { SchoolNoticesScreen } from "~/features/school-notices/components/school-notices-screen";
import { LANGUAGE_STORAGE_KEY } from "~/shared/i18n";
import { renderRoute, screen } from "../../../router";

const notice = {
  post_id: 7,
  title: "체육대회 안내",
  category: "학생회",
  author: "학생부",
  posted_on: "2026-10-20",
  has_attachment: true,
  synced_at: "2026-10-21T00:00:00Z",
};

afterEach(() => {
  window.localStorage.clear();
});

describe("school notices in English", () => {
  it("translates the list chrome but keeps the notice content as served", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    renderRoute(() => <SchoolNoticesScreen notices={[notice]} />);

    expect(screen.getByText("체육대회 안내")).toBeVisible();
    expect(screen.getByText("학생회")).toBeVisible();
    expect(screen.getByLabelText("Has attachment")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeVisible();
  });

  it("translates the empty state and the load failure", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    const { unmount } = renderRoute(() => <SchoolNoticesScreen notices={[]} />);
    expect(screen.getByText("No notices yet")).toBeVisible();
    unmount();

    renderRoute(() => <SchoolNoticesScreen notices={null} />);
    expect(screen.getByText("Couldn't load school notices.")).toBeVisible();
  });

  it("translates the detail screen labels", () => {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, "en");
    renderRoute(() => (
      <SchoolNoticeDetailScreen
        notice={{
          ...notice,
          body: "",
          attachments: [{ attachment_id: 3, name: "일정.pdf", size: 10 }],
        }}
      />
    ));

    expect(screen.getByText("No content.")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Attachments" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: /View on school site\s*\(new tab\)/ }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: /일정\.pdf\s*\(new tab\)/ }),
    ).toBeVisible();
  });
});
