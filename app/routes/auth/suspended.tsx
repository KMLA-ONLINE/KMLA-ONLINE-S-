import { RefreshCwIcon, ShieldAlertIcon } from "lucide-react";
import { Form, redirect, useRevalidator } from "react-router";

import {
  AuthCard,
  describeSuspensionEnd,
  getProfileDestination,
  loadAuthState,
  loadMySuspension,
  signOut,
} from "~/features/auth";
import {
  DeferredAdminContactList,
  listAdminContacts,
} from "~/features/support";
import { useClientNow } from "~/shared/hooks/use-client-now";
import { useLocale, useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/suspended";

export async function clientLoader() {
  const state = await loadAuthState();
  if (!state) throw redirect("/login");
  if (state.profile?.status !== "accepted") {
    const destination = getProfileDestination(state.profile);
    if (destination === "/login") await signOut();
    throw redirect(destination);
  }

  const suspension = await loadMySuspension();
  // 정지가 끝났거나 풀렸으면 앱으로 돌아간다. 게이트가 다시 확인한다.
  if (!suspension) throw redirect("/");

  return {
    profile: state.profile,
    suspension,
    contacts: listAdminContacts().catch(() => []),
  };
}

export default function SuspendedPage({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const checking = revalidator.state === "loading";
  const { profile, suspension } = loaderData;
  const now = useClientNow();
  const t = useT();
  const locale = useLocale();
  const end = describeSuspensionEnd(suspension.expires_at, now, locale);

  return (
    <AuthCard
      title={t("이용이 정지되었어요")}
      description={t("{name}님의 KMLA Online 이용이 정지되었습니다.", {
        name: profile.name,
      })}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlertIcon className="size-6" />
          </div>
          <dl className="flex w-full flex-col gap-3 text-sm">
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{t("사유")}</dt>
              <dd className="font-medium break-words whitespace-pre-wrap">
                {suspension.reason}
              </dd>
            </div>
            <div className="flex flex-col gap-1">
              <dt className="text-muted-foreground">{t("해제 예정")}</dt>
              <dd className="font-medium">
                {end ? (
                  <>
                    {end.label}
                    <span className="text-muted-foreground">
                      {" "}
                      ·{" "}
                      {end.remainingDays
                        ? t("{count}일 남음", { count: end.remainingDays })
                        : t("기간이 끝났어요. 상태를 확인해 주세요")}
                    </span>
                  </>
                ) : (
                  t("무기한")
                )}
              </dd>
            </div>
          </dl>
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
          {t("정지 상태 확인")}
        </Button>
        <Form method="post" action="/logout">
          <Button type="submit" variant="ghost" className="w-full">
            {t("다른 계정으로 로그인")}
          </Button>
        </Form>
        <DeferredAdminContactList
          contacts={loaderData.contacts}
          prompt={t("정지가 잘못된 것 같나요?")}
        />
      </div>
    </AuthCard>
  );
}
