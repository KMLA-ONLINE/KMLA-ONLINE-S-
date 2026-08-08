import { Clock3Icon, RefreshCwIcon } from "lucide-react";
import { Form, redirect, useRevalidator } from "react-router";

import {
  AuthCard,
  getProfileDestination,
  loadAuthState,
  signOut,
} from "~/features/auth";
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
  return state;
}

export default function PendingPage({ loaderData }: Route.ComponentProps) {
  const revalidator = useRevalidator();
  const checking = revalidator.state === "loading";
  const profile = loaderData.profile!;

  return (
    <AuthCard
      title="가입 신청을 확인하고 있어요"
      description={`${profile.name}님의 학교 구성원 정보를 관리자가 검토 중입니다.`}
    >
      <div className="flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 rounded-2xl bg-muted p-6 text-center">
          <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Clock3Icon className="size-6" />
          </div>
          <div>
            <p className="font-medium">승인 대기 중</p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              승인되면 모든 커뮤니티 기능을 사용할 수 있습니다.
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
          승인 상태 확인
        </Button>
        <Form method="post" action="/logout">
          <Button type="submit" variant="ghost" className="w-full">
            다른 계정으로 로그인
          </Button>
        </Form>
      </div>
    </AuthCard>
  );
}
