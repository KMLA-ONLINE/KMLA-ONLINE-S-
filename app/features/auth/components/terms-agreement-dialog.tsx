import { useEffect, useState } from "react";
import { Form, Link } from "react-router";

import { TermsAgreementField } from "~/features/auth/components/terms-agreement-field";
import { agreeToTerms } from "~/features/auth/data/mutations";
import { getAuthErrorMessage } from "~/features/auth/model/format";
import {
  formatTermsDate,
  TERMS_FIRST_EFFECTIVE_DATE,
  TERMS_VERSION,
} from "~/features/auth/model/terms";
import { useLocale, useT } from "~/shared/i18n";
import { setPromptActive } from "~/shared/lib/prompt-coordinator";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { FieldError } from "~/shared/ui/field";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 약관 시행 전에 가입한 회원에게 받는 이용약관 동의. 동의는 필수라 닫기 버튼과 바깥 클릭,
 * Esc로 닫히지 않으며, 동의하지 않으려는 사람에게는 로그아웃만 열어 둔다.
 *
 * 화면에서만 막고 DB 접근은 막지 않는다. RLS로 막으면 업데이트를 아직 받지 않은 옛 앱
 * 셸에서는 이 팝업 없이 모든 조회가 실패한다.
 *
 * 동의가 기록되면 바로 닫고, 프로필을 다시 읽는 일은 `onAgreed`를 넘긴 화면이 맡는다.
 *
 * 문구는 `docs/legal/privacy_notice.md` 2항이 소유하며 테스트가 같은 문장인지 확인한다.
 */
export function TermsAgreementDialog({
  open,
  onAgreed,
}: {
  open: boolean;
  onAgreed: () => Promise<void> | void;
}) {
  const [checked, setChecked] = useState(false);
  const [pending, setPending] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState<string>();
  const visible = open && !agreed;
  const t = useT();
  const locale = useLocale();

  // 셸의 알림 권한·홈 화면 추가 안내가 이 창을 보고 물러난다.
  useEffect(() => {
    setPromptActive("terms", visible);
    return () => setPromptActive("terms", false);
  }, [visible]);

  async function agree() {
    setPending(true);
    setError(undefined);
    try {
      await agreeToTerms(TERMS_VERSION);
      setAgreed(true);
      await onAgreed();
    } catch (failure) {
      setError(getAuthErrorMessage(failure, locale));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open={visible} disablePointerDismissal>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>
            {t("이용약관과 개인정보 처리방침이 시행되었습니다")}
          </DialogTitle>
          <DialogDescription className="leading-relaxed">
            {t(
              "{date}부터 KMLA Online 이용약관과 개인정보 처리방침이 시행되었습니다. 생년월일, 성별, 계열은 선택 정보로 바뀌었으며, 이미 입력한 정보는 지금처럼 프로필에 표시됩니다. 원하지 않으면 프로필 편집에서 지울 수 있습니다.",
              { date: formatTermsDate(TERMS_FIRST_EFFECTIVE_DATE, locale) },
            )}
          </DialogDescription>
        </DialogHeader>

        <TermsAgreementField
          id="terms-agreement-dialog"
          checked={checked}
          onCheckedChange={setChecked}
          disabled={pending}
        />
        {error ? <FieldError>{error}</FieldError> : null}

        <DialogFooter>
          <Button
            variant="outline"
            render={
              <Link to="/privacy-policy" target="_blank" rel="noreferrer" />
            }
            nativeButton={false}
          >
            {t("개인정보 처리방침 보기")}
          </Button>
          <Button
            type="button"
            onClick={() => void agree()}
            disabled={!checked || pending}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t("계속하기")}
          </Button>
        </DialogFooter>
        <Form method="post" action="/logout" className="-mt-2 self-center">
          <Button
            type="submit"
            variant="link"
            size="sm"
            className="text-muted-foreground"
          >
            {t("동의하지 않고 로그아웃")}
          </Button>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
