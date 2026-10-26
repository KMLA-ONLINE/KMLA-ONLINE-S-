import { defineAppChrome, PageHeader } from "~/features/app-shell";

import { DonationsScreen } from "~/features/donations";
import { useT } from "~/shared/i18n";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "5xl",
});

export default function DonationsPage() {
  const t = useT();

  return (
    <>
      <PageHeader title={t("기부물품")} back="/menu" />
      <DonationsScreen />
    </>
  );
}
