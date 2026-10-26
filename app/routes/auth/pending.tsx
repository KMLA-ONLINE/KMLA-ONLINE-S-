import { Clock3Icon, RefreshCwIcon } from "lucide-react";
import { Form, redirect, useRevalidator } from "react-router";

import {
  AuthCard,
  getProfileDestination,
  loadAuthState,
  needsTermsAgreement,
  signOut,
  TermsAgreementDialog,
} from "~/features/auth";
import {
  DeferredAdminContactList,
  listAdminContacts,
} from "~/features/support";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/pending";

export async function clientLoader() {
  const state = await loadAuthState();
  if (!state) throw redirect("/login");
  if (state.profile?.status !== "pending") {
    const destination = getProfileDestination(state.profile);
    if (destination === "/login") await signOut();
    throw redirect(destination);
  }
  return { ...state, contacts: listAdminContacts().catch(() => []) };
}

export default function PendingPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const revalidator = useRevalidator();
  const checking = revalidator.state === "loading";
  const profile = loaderData.profile!;

  return (
    <AuthCard
      title={t("가입 신청을 확인하고 있어요")}
      description={t("{name}님의 정보를 관리자가 검토 중입니다.", {
        name: profile.name,
      })}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Clock3Icon className="size-6" />
          </div>
          <div>
            <p className="font-medium">{t("승인 대기 중")}</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={() => void revalidator.revalidate()}
          disabled={checking}
        >
          {checking ? (
            <Spinner data-icon="inline-start" />
          ) : (
            <RefreshCwIcon data-icon="inline-start" />
          )}
          {t("승인 상태 확인")}
        </Button>
        <Form method="post" action="/logout">
          <Button type="submit" variant="ghost" className="w-full">
            {t("다른 계정으로 로그인")}
          </Button>
        </Form>
        <DeferredAdminContactList
          contacts={loaderData.contacts}
          prompt={t("승인이 너무 오래 걸리나요?")}
        />
      </div>
      {/* 약관 시행 전에 신청해 승인을 기다리는 사람도 동의를 받는다. */}
      <TermsAgreementDialog
        open={needsTermsAgreement(profile)}
        onAgreed={() => revalidator.revalidate()}
      />
    </AuthCard>
  );
}
