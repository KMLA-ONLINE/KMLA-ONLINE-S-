import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
});

export default function ProfilePage() {
  return (
    <>
      <PageHeader title="프로필" back />
      <StubPage title="프로필" description="남의 프로필이 들어갑니다." />
    </>
  );
}
