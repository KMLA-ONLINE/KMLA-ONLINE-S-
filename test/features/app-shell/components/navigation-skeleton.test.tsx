import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NavigationSkeleton } from "~/features/app-shell/components/navigation-skeleton";

describe("NavigationSkeleton", () => {
  it.each(["/", "/groups", "/groups/discover", "/groups/example"])(
    "renders an accessible pending region for %s",
    (pathname) => {
      render(<NavigationSkeleton pathname={pathname} />);

      expect(
        screen.getByRole("region", { name: "화면을 불러오는 중" }),
      ).toHaveAttribute("aria-busy", "true");
    },
  );
});
