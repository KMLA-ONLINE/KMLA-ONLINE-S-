import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { Field, FieldError, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";

export function PasswordField({
  id,
  name,
  label,
  autoComplete,
  defaultValue,
  error,
  disabled,
}: {
  id: string;
  name: string;
  label: string;
  autoComplete: string;
  defaultValue?: string;
  error?: string;
  disabled?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const t = useT();
  // 라벨은 호출자가 한국어 원문으로 넘기고 여기서 번역한다. 비밀번호 변경·탈퇴 화면도 그렇다.
  const labelText = t(label);

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{labelText}</FieldLabel>
      <div className="flex gap-2">
        <Input
          id={id}
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          defaultValue={defaultValue}
          aria-invalid={Boolean(error)}
          disabled={disabled}
          required
        />
        <Button
          type="button"
          variant="outline"
          size="icon"
          aria-label={
            visible
              ? t("{label} 숨기기", { label: labelText })
              : t("{label} 표시하기", { label: labelText })
          }
          aria-pressed={visible}
          // 누를 때 포커스가 버튼으로 옮겨 가면 입력란이 blur돼 모바일 키보드가 닫힌다.
          // 키보드 사용자는 Tab으로 버튼에 올 수 있으니 포커스 이동만 막는다.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
          disabled={disabled}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </div>
      <FieldError>{error}</FieldError>
    </Field>
  );
}
