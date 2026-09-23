import { afterEach, vi } from "vitest";
import { resetQueryClientForTests } from "~/shared/lib/query-client";

// The Node project renders nothing, so there is no Testing Library cleanup to
// run and no jsdom globals to stub — see `test/setup.ts` for those. Mock
// restoration is the one thing both projects need.
afterEach(() => {
  resetQueryClientForTests();
  vi.restoreAllMocks();
});
