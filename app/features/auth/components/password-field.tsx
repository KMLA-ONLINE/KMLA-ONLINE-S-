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
