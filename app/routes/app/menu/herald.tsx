import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { HeraldScreen } from "~/features/herald/components/herald-screen";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
  contentWidth: "full",
});

export default function HeraldPage() {
  const { profile } = useAppShell();
  return (
    <>
      <PageHeader title="Minjok Herald" back="/menu" />
      <HeraldScreen
        key={profile.id}
        viewer={{
          id: profile.id,
          pubId: profile.pub_id,
          name: profile.name,
          type: profile.type,
          role: profile.role,
        }}
      />
    </>
  );
}
