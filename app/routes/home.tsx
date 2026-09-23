import { Link } from "react-router";

import { Button, buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { getSupabase } from "~/lib/supabase/client";
import type { Route } from "./+types/home";

export function meta(_: Route.MetaArgs) {
  return [
    { title: "KMLA Online" },
    { name: "description", content: "KMLA 커뮤니티" },
  ];
}

type ConnectionStatus =
  { ok: true; session: boolean } | { ok: false; error: string };

/**
 * Runs in the browser only — SPA mode has no server loaders. Doubles as a smoke
 * test that the Supabase env vars and local stack are wired up.
 */
export async function clientLoader(): Promise<ConnectionStatus> {
  try {
    const { data, error } = await getSupabase().auth.getSession();
    if (error) return { ok: false, error: error.message };
    return { ok: true, session: data.session !== null };
  } catch (cause) {
    return { ok: false, error: (cause as Error).message };
  }
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const status = loaderData;

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col justify-center gap-6 p-6">
      <h1 className="font-heading text-2xl font-semibold">KMLA Online</h1>
      <Card>
        <CardHeader>
          <CardTitle>스택 상태</CardTitle>
          <CardDescription>
            React Router {"("}SPA{")"} · Supabase · shadcn/ui · PWA
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          <p className="text-sm text-muted-foreground" data-testid="db-status">
            {status.ok
              ? `Supabase 연결됨 · 세션 ${status.session ? "있음" : "없음"}`
              : `Supabase 연결 실패: ${status.error}`}
          </p>
          <div className="flex gap-2">
            <Button>시작하기</Button>
            <Link
              className={buttonVariants({ variant: "outline" })}
              to="/theme"
            >
              팔레트 보기
            </Link>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
