import { TriangleAlertIcon } from "lucide-react";
import { useRef, useState } from "react";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigation,
  useSubmit,
} from "react-router";

import { defineAppChrome, PageHeader, useAppShell } from "~/features/app-shell";
import {
  describeWithdrawalBlocker,
  describeWithdrawalError,
  getWithdrawalBlockers,
  hasErrors,
  listMyOwnedGroups,
  PasswordField,
  readFormText,
  withdrawAccount,
} from "~/features/auth";
import { getCurrentLocale, translate, useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Checkbox } from "~/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "~/shared/ui/field";
import { Spinner } from "~/shared/ui/spinner";
import type { Route } from "./+types/withdraw";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

interface WithdrawErrors {
  confirm?: string;
  password?: string;
  form?: string;
}

/** 확인 대화상자를 열기 전과 `clientAction`이 같은 규칙으로 본다. */
function validateWithdrawal(formData: FormData): WithdrawErrors {
  const locale = getCurrentLocale();
  return {
    confirm: formData.get("confirm")
      ? undefined
      : translate(locale, "안내를 확인했다고 체크해 주세요."),
    password: readFormText(formData, "password")
      ? undefined
      : translate(locale, "비밀번호를 입력해 주세요."),
  };
}

export async function clientLoader() {
  return { ownedGroups: await listMyOwnedGroups() };
}

export async function clientAction({ request }: Route.ClientActionArgs) {
  const formData = await request.formData();
  const errors = validateWithdrawal(formData);
  if (hasErrors(errors)) {
    return data({ errors }, { status: 400 });
  }

  try {
    await withdrawAccount(readFormText(formData, "password"));
  } catch (error) {
    const { field, message } = describeWithdrawalError(error);
    const errors: WithdrawErrors =
      field === "password" ? { password: message } : { form: message };
    return data({ errors }, { status: 400 });
  }

  throw redirect("/login?withdrawn=1");
}

export default function WithdrawPage({
  loaderData,
  actionData,
}: Route.ComponentProps) {
  const { profile } = useAppShell();
  const t = useT();
  const navigation = useNavigation();
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [inputErrors, setInputErrors] = useState<WithdrawErrors | null>(null);
  const pending = navigation.state === "submitting";
  const errors: WithdrawErrors = inputErrors ?? actionData?.errors ?? {};
  const blockers = getWithdrawalBlockers({
    role: profile.role,
    ownedGroups: loaderData.ownedGroups,
  });

  return (
    <>
      <PageHeader title={t("계정 탈퇴")} back="/settings" />

      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">
          {t("계정 탈퇴")}
        </h1>

        <section className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-sm">
          <p className="font-medium">{t("탈퇴하면 되돌릴 수 없습니다.")}</p>
          <ul className="flex list-disc flex-col gap-1.5 pl-5 text-muted-foreground">
            <li>
              {t(
                "이메일, 비밀번호, 프로필, 시간표, 알림 설정과 기기 알림을 바로 삭제하고 다시 로그인할 수 없습니다.",
              )}
            </li>
            <li>
              {t(
                "내 타임라인의 글과 스토리, 예약, 그룹 가입 상태가 삭제되고 그룹 대화방에서 나갑니다.",
              )}
            </li>
            <li>
              {t(
                "그룹에 쓴 게시물·댓글·반응과 보낸 메시지는 대화 흐름을 위해 ‘탈퇴한 사용자’ 이름으로 남습니다. 지우려면 탈퇴 전에 직접 삭제하거나, 탈퇴 후 가입한 이메일로 운영자에게 요청해 주세요.",
              )}
            </li>
            <li>
              {t("같은 이메일로 다시 가입하면 새 계정으로 심사를 받습니다.")}
            </li>
          </ul>
        </section>

        {blockers.length > 0 ? (
          <section
            aria-labelledby="withdraw-blockers"
            className="flex flex-col gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm"
          >
            <h2
              id="withdraw-blockers"
              className="flex items-center gap-2 font-medium text-destructive"
            >
              <TriangleAlertIcon className="size-4" aria-hidden />
              {t("먼저 정리해야 탈퇴할 수 있습니다")}
            </h2>
            {blockers.map((blocker) =>
              blocker.kind === "app_admin" ? (
                <p key="app_admin">{describeWithdrawalBlocker("app_admin")}</p>
              ) : (
                <div key="group_owner" className="flex flex-col gap-1.5">
                  <p>{t("다음 그룹의 소유권을 다른 멤버에게 넘겨 주세요.")}</p>
                  <ul className="flex flex-col gap-1 pl-1">
                    {blocker.groups.map((group) => (
                      <li key={group.id}>
                        <Link
                          to={`/groups/${group.slug}`}
                          className="font-medium underline underline-offset-4"
                        >
                          {group.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ),
            )}
            <p className="text-muted-foreground">
              {t("넘길 사람이 없으면 도움말의 문의처로 탈퇴를 요청해 주세요.")}
            </p>
          </section>
        ) : (
          <Form
            ref={formRef}
            method="post"
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              // Enter 제출도 확인 대화상자를 거치게 한다. 되돌릴 수 없다고 묻기 전에 입력부터 확인한다.
              event.preventDefault();
              const next = validateWithdrawal(
                new FormData(event.currentTarget),
              );
              setInputErrors(hasErrors(next) ? next : null);
              if (!hasErrors(next)) setConfirmOpen(true);
            }}
          >
            <section className="rounded-xl border bg-card p-4">
              <FieldGroup>
                <Field
                  orientation="horizontal"
                  data-invalid={Boolean(errors.confirm)}
                >
                  <Checkbox
                    id="withdraw-confirm"
                    checked={acknowledged}
                    onCheckedChange={setAcknowledged}
                    aria-invalid={Boolean(errors.confirm)}
                    disabled={pending}
                  />
                  {acknowledged ? (
                    <input type="hidden" name="confirm" value="on" />
                  ) : null}
                  <FieldLabel htmlFor="withdraw-confirm">
                    {t("위 내용을 확인했으며 탈퇴에 동의합니다.")}
                  </FieldLabel>
                </Field>
                <FieldError>{errors.confirm}</FieldError>
                <PasswordField
                  id="withdraw-password"
                  name="password"
                  label={t("현재 비밀번호")}
                  autoComplete="current-password"
                  error={errors.password}
                  disabled={pending}
                />
                {errors.form ? <FieldError>{errors.form}</FieldError> : null}
              </FieldGroup>
            </section>

            <Button
              type="submit"
              variant="destructive"
              size="lg"
              disabled={pending}
            >
              {pending ? <Spinner data-icon="inline-start" /> : null}
              {t("탈퇴하기")}
            </Button>
          </Form>
        )}
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent className="max-w-xs" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t("정말 탈퇴하시겠습니까?")}</DialogTitle>
            <DialogDescription>
              {t("계정과 개인 정보가 바로 삭제되며 되돌릴 수 없습니다.")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setConfirmOpen(false)}
            >
              {t("취소")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                if (formRef.current) void submit(formRef.current);
              }}
            >
              {t("탈퇴")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
