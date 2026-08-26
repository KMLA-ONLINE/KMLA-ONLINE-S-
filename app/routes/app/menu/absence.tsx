import { Navigate } from "react-router";

import { AbsenceEditor } from "~/features/absences/components/absence-editor";
import { listTodayAbsences } from "~/features/absences/data/queries";
import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";

import type { Route } from "./+types/absence";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export async function clientLoader() {
  return {
    absences: await listTodayAbsences().catch(() => []),
  };
}

export default function AbsencePage({ loaderData }: Route.ComponentProps) {
  const { profile } = useAppShell();

  if (profile.type !== "student") {
    return <Navigate to="/menu" replace />;
  }

  const mine =
    loaderData.absences.find((item) => item.pubId === profile.pub_id) ?? null;

  return (
    <>
      <PageHeader
        title={mine ? "공결 & 병결 수정" : "공결 & 병결 알리기"}
        back="/menu"
      />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">
          {mine ? "공결 & 병결 수정" : "공결 & 병결 알리기"}
        </h1>

        <AbsenceEditor initialReason={mine?.reason ?? null} />
      </div>
    </>
  );
}
