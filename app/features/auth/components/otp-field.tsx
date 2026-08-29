import { Fragment } from "react";
import { REGEXP_ONLY_DIGITS } from "input-otp";

import { Field, FieldError, FieldLabel } from "~/shared/ui/field";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "~/shared/ui/input-otp";

const GROUPS = [
  [0, 1, 2],
  [3, 4, 5],
];

export function OtpField({
  id,
  label = "인증 코드",
  error,
  disabled,
}: {
  id: string;
  label?: string;
  error?: string;
  disabled?: boolean;
}) {
  const invalid = Boolean(error);

  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <InputOTP
        id={id}
        name="otp"
        maxLength={6}
        pattern={REGEXP_ONLY_DIGITS}
        disabled={disabled}
        aria-invalid={invalid}
      >
        {GROUPS.map((group, groupIndex) => (
          <Fragment key={group[0]}>
            {groupIndex > 0 ? <InputOTPSeparator /> : null}
            <InputOTPGroup>
              {group.map((index) => (
                <InputOTPSlot
                  key={index}
                  index={index}
                  aria-invalid={invalid}
                />
              ))}
            </InputOTPGroup>
          </Fragment>
        ))}
      </InputOTP>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
