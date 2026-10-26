import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  faqSections,
  FaqScreen,
  supportContacts,
  supportNote,
} from "~/features/support";
import { useT } from "~/shared/i18n";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "2xl",
});

export default function SupportPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("도움말")} back="/settings" />

      <FaqScreen
        sections={faqSections}
        contacts={supportContacts}
        note={supportNote}
      />
    </>
  );
}
