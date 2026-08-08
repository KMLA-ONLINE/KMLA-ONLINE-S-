import { PageHeader } from "~/domains/shell";
import { StubPage } from "~/shared/components/stub-page";

export default function MealPage() {
  return (
    <>
      <PageHeader title="급식" />
      <StubPage title="급식" description="급식 식단표가 들어갑니다." />
    </>
  );
}
