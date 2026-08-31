import { defineAppChrome, PageHeader } from "~/features/app-shell";
import {
  faqSections,
  FaqScreen,
  supportContacts,
  supportNote,
} from "~/features/support";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "2xl",
});

export default function SupportPage() {
  return (
    <>
      <PageHeader title="도움말" back="/menu" />

      <FaqScreen
        sections={faqSections}
        contacts={supportContacts}
        note={supportNote}
      />
    </>
  );
}
