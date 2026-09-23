import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { UtilityBookingScreen } from "~/features/school-utilities";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export default function GongangPage() {
  return (
    <>
      <PageHeader title="공강 · 노래방" back="/menu" />
      <UtilityBookingScreen mode="gongang" />
    </>
  );
}
