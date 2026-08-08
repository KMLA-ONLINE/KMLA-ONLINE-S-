import { ConstructionIcon } from "lucide-react";

/**
 * 아직 구현되지 않은 화면의 자리표시자.
 *
 * `routes.ts`가 앱의 URL 지도이고 셸(레이아웃 배치·내비게이션·인증 게이트)이 실제로 눌러 봐야
 * 검증되기 때문에, 화면보다 라우트를 먼저 깔았다. 각 도메인이 자기 화면을 구현하면서 하나씩
 * 지운다.
 *
 * **이 파일의 참조가 0이 되면 파일도 지운다.** `rg StubPage app`로 남은 개수를 센다.
 */
export function StubPage({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-24 text-center text-muted-foreground">
      <ConstructionIcon className="size-8" />
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">{title}</p>
        <p className="text-sm">
          {description ?? "아직 만들지 않은 화면입니다."}
        </p>
      </div>
    </div>
  );
}
