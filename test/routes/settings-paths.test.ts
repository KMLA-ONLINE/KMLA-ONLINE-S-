import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "~/routes";

describe("settings URLs", () => {
  it("registers settings screens under the app shell without legacy aliases", () => {
    for (const [path, file] of [
      ["/settings", "routes/app/menu/settings.tsx"],
      ["/settings/noti", "routes/app/notification-settings.tsx"],
      ["/settings/lab", "routes/app/menu/settings-lab.tsx"],
      ["/settings/password", "routes/app/menu/password.tsx"],
      ["/support", "routes/app/support.tsx"],
      ["/licenses", "routes/app/menu/licenses.tsx"],
    ]) {
      const matches = matchRoutes(routes as RouteObject[], path);
      expect(
        matches?.map(({ route }) => "file" in route && route.file),
      ).toEqual(["routes/app/gate.tsx", "routes/app/layout.tsx", file]);
    }

    for (const path of [
      "/menu/settings",
      "/noti/settings",
      "/menu/settings/lab",
      "/menu/password",
      "/menu/licenses",
    ]) {
      const matches = matchRoutes(routes as RouteObject[], path);
      expect(
        matches?.map(({ route }) => "file" in route && route.file),
      ).toEqual(["routes/catch-all.tsx"]);
    }
  });
});
