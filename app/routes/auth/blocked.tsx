import { RefreshCwIcon, ShieldXIcon } from "lucide-react";
import { Form, redirect, useRevalidator } from "react-router";

import {
  AuthCard,
  getProfileDestination,
  loadAuthState,
  signOut,
} from "~/features/auth";
import {
  DeferredAdminContactList,
  listAdminContacts,
} from "~/features/support";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/blocked";

export async function clientLoader() {
  const state = await loadAuthState();
  if (!state) throw redirect("/login");
  if (state.profile?.status !== "blocked") {
    const destination = getProfileDestination(state.profile);
    if (destination === "/login") await signOut();
    throw redirect(destination);
  }
  return { ...state, contacts: listAdminContacts().catch(() => []) };
}

export default function BlockedPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const revalidator = useRevalidator();
  const checking = revalidator.state === "loading";
  const profile = loaderData.profile!;

  return (
    <AuthCard
      title={t("가입 신청이 차단되었어요")}
      description={t("{name}님의 가입 신청이 차단되었습니다.", {
        name: profile.name,
      })}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldXIcon className="size-6" />
          </div>
          <div className="flex flex-col gap-1">
            <p className="font-medium">{t("가입 차단", undefined, "status")}</p>
            <p className="text-sm text-muted-foreground">
              {t(
                "학교 구성원이라면 관리자에게 확인을 요청한 뒤 상태를 다시 확인해 주세요.",
              )}
            </p>
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
          {t("차단 상태 확인")}
        </Button>
        <Form method="post" action="/logout">
          <Button type="submit" variant="ghost" className="w-full">
            {t("다른 계정으로 로그인")}
          </Button>
        </Form>
        <DeferredAdminContactList
          contacts={loaderData.contacts}
          prompt={t("차단이 잘못된 것 같나요?")}
        />
      </div>
    </AuthCard>
  );
}
