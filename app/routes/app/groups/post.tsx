import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
});

export default function GroupPostPage() {
  return (
    <>
      <PageHeader title="게시물" back />
      <StubPage title="게시물" description="게시물 상세와 댓글이 들어갑니다." />
    </>
  );
}
