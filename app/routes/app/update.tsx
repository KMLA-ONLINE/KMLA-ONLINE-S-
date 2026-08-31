import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { releases, ReleaseNotesScreen } from "~/features/support";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "2xl",
});

export default function UpdatePage() {
  return (
    <>
      <PageHeader title="업데이트 기록" back="/menu" />

      <ReleaseNotesScreen releases={releases} />
    </>
  );
}
