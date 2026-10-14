import { defineAppChrome, PageHeader } from "~/features/app-shell";

import { DonationsScreen } from "~/features/donations";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
});

export default function DonationsPage() {
  return (
    <>
      <PageHeader title="기부물품" back="/menu" />
      <DonationsScreen />
    </>
  );
}
