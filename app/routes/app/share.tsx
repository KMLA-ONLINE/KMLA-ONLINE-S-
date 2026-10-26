import { useSearchParams } from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import { useT } from "~/shared/i18n";
import { composeSharedText, ShareTargetScreen } from "~/features/messaging";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "none",
  contentWidth: "2xl",
});

/**
 * `share`. 설치한 PWA의 Web Share Target(`manifest.webmanifest`의 `share_target`)이 GET으로 여는 화면이다
 * (기능 명세 §13.24). 받은 글은 쿼리에만 있고 서버로 보내지 않는다. 로그인 전이면 게이트가 쿼리째
 * `next`로 넘겨 로그인 뒤 이 화면으로 돌아온다.
 */
export default function ShareTargetPage() {
  const t = useT();
  const [searchParams] = useSearchParams();
  const { profile } = useAppShell();
  const text = composeSharedText({
    title: searchParams.get("title") ?? "",
    text: searchParams.get("text") ?? "",
    url: searchParams.get("url") ?? "",
  });

  return (
    <>
      <PageHeader
        title={t("메시지로 보내기")}
        back={{ fallback: "/messenger" }}
      />
      <ShareTargetScreen text={text} viewerId={String(profile.id)} />
    </>
  );
}
