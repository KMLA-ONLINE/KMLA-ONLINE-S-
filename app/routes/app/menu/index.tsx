import { Link } from "react-router";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { StubPage } from "~/shared/components/stub-page";
import { Button } from "~/shared/ui/button";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function MenuPage() {
  return (
    <>
      <PageHeader title="메뉴" />
      <StubPage title="메뉴" description="설정·바로가기 목록이 들어갑니다." />
      <div className="px-4 pb-4 md:hidden">
        <Button className="w-full" render={<Link to="/messenger" />}>
          메시지
        </Button>
      </div>
    </>
  );
}
