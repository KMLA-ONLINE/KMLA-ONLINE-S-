import { defineAppChrome, PageHeader } from "~/features/app-shell";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

// 기부물품 기능은 아직 없다. 메뉴 타일이 갈 자리만 먼저 둔다.
export default function DonationsPage() {
  return (
    <>
      <PageHeader title="기부물품" back="/menu" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">기부물품</h1>
      </div>
    </>
  );
}
