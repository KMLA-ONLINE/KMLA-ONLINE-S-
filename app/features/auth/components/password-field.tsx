import { useState } from "react";
import { EyeIcon, EyeOffIcon } from "lucide-react";

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

  return (
    <Field data-invalid={Boolean(error)}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
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
          aria-label={visible ? `${label} 숨기기` : `${label} 표시하기`}
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
