import {
  BellIcon,
  CircleQuestionMarkIcon,
  FileTextIcon,
  FlaskConicalIcon,
  KeyRoundIcon,
  ScrollTextIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useId, type ReactNode } from "react";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { HomeSidebarSettings } from "~/features/app-shell/components/home-sidebar-settings";
import { LogoutButton } from "~/features/auth";
import { AppVersionCard } from "~/features/support";
import { ListLinkRow } from "~/shared/components/list-link-row";
import { useEnterToSend } from "~/shared/hooks/use-enter-to-send";
import { useExperimentalFeatures } from "~/shared/hooks/use-experimental-features";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldTitle,
} from "~/shared/ui/field";
import { Switch } from "~/shared/ui/switch";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

/** 모든 묶음을 `제목 + 카드 한 장`으로 맞춘다. 행 사이 선은 카드의 `divide-y`가 그린다. */
function SettingsSection({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-1.5">
      <h2
        id={headingId}
        className="px-1 text-xs font-semibold tracking-wide text-muted-foreground"
      >
        {title}
      </h2>
      <div className="divide-y overflow-hidden rounded-xl border bg-card">
        {children}
      </div>
    </section>
  );
}

export default function SettingsPage() {
  const [experimentalFeaturesEnabled, setExperimentalFeaturesEnabled] =
    useExperimentalFeatures();
  const [enterToSend, setEnterToSend] = useEnterToSend();

  return (
    <>
      <PageHeader title="설정" back="/menu" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">설정</h1>

        <SettingsSection title="계정">
          <ListLinkRow
            to="/settings/password"
            label="비밀번호 변경"
            icon={KeyRoundIcon}
          />
        </SettingsSection>

        <SettingsSection title="앱 설정">
          <ListLinkRow to="/settings/noti" label="알림 설정" icon={BellIcon} />
          <HomeSidebarSettings />
          <Field orientation="horizontal" className="px-4 py-3">
            <FieldContent>
              <FieldTitle>Enter로 보내기 (추천)</FieldTitle>
              <FieldDescription>
                키보드의 Enter로 메시지와 댓글을 보냅니다. 화면 키보드에서는
                줄바꿈입니다.
              </FieldDescription>
            </FieldContent>
            <Switch
              aria-label="Enter로 보내기"
              checked={enterToSend}
              onCheckedChange={setEnterToSend}
            />
          </Field>
          <Field orientation="horizontal" className="px-4 py-3">
            <FieldContent>
              <FieldTitle>실험실 기능 사용</FieldTitle>
              <FieldDescription>
                변경되거나 제거될 수 있습니다.
              </FieldDescription>
            </FieldContent>
            <Switch
              aria-label="실험실 기능 사용"
              checked={experimentalFeaturesEnabled}
              onCheckedChange={setExperimentalFeaturesEnabled}
            />
          </Field>
          {experimentalFeaturesEnabled ? (
            <ListLinkRow
              to="/settings/lab"
              label="실험실 설정"
              icon={FlaskConicalIcon}
            />
          ) : null}
        </SettingsSection>

        <SettingsSection title="서비스 안내">
          <ListLinkRow
            to="/support"
            label="도움말"
            icon={CircleQuestionMarkIcon}
          />
          <ListLinkRow
            to="/terms-of-service"
            label="이용약관"
            icon={ScrollTextIcon}
          />
          <ListLinkRow
            to="/privacy-policy"
            label="개인정보 처리방침"
            icon={ShieldCheckIcon}
          />
          <ListLinkRow
            to="/licenses"
            label="오픈소스 라이선스"
            icon={FileTextIcon}
          />
          <AppVersionCard appearance="row" />
        </SettingsSection>

        <LogoutButton />
      </div>
    </>
  );
}
