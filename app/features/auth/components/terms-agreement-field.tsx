import { Fragment } from "react";

import { TERMS_FIELD, TERMS_VERSION } from "~/features/auth/model/terms";
import { useT } from "~/shared/i18n";
import { Checkbox } from "~/shared/ui/checkbox";
import { Field, FieldError, FieldLabel } from "~/shared/ui/field";

/**
 * 이용약관 동의 체크박스. 개인정보 안내는 동의 대상이 아니므로 여기에 묶지 않는다.
 *
 * 약관은 새 탭으로 연다. 가입 화면의 이메일·비밀번호는 폼 안에만 있어서, 같은 탭에서
 * 떠나면 입력한 값이 사라진다.
 */
export function TermsAgreementField({
  id,
  checked,
  onCheckedChange,
  error,
  disabled,
}: {
  id: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  error?: string;
  disabled?: boolean;
}) {
  const t = useT();

  return (
    <Field orientation="horizontal" data-invalid={Boolean(error)}>
      <Checkbox
        id={id}
        name={TERMS_FIELD}
        value={TERMS_VERSION}
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-invalid={Boolean(error)}
        disabled={disabled}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor={id} className="font-normal">
          {/* 영어는 어순이 달라 링크가 문장 앞에 온다. 문장을 통째로 번역하고 링크 자리만 바꾼다. */}
          <span>
            {t("{terms}에 동의합니다. (필수)", { terms: "\u0000" })
              .split("\u0000")
              .map((part, index) => (
                <Fragment key={index}>
                  {index > 0 ? (
                    <a
                      href="/terms-of-service"
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-primary underline underline-offset-2"
                    >
                      {t("이용약관")}
                    </a>
                  ) : null}
                  {part}
                </Fragment>
              ))}
          </span>
        </FieldLabel>
        <FieldError>{error}</FieldError>
      </div>
    </Field>
  );
}
