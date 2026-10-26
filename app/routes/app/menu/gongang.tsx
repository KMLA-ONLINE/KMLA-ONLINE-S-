import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { useT } from "~/shared/i18n";
import { UtilityBookingScreen } from "~/features/school-utilities";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "5xl",
});

export default function GongangPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("공강 · 노래방")} back="/menu" />
      <UtilityBookingScreen mode="gongang" />
    </>
  );
}
