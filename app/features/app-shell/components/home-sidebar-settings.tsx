import { useId } from "react";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/shared/ui/field";
import { Switch } from "~/shared/ui/switch";
import { useHomeSidebarPreferences } from "../hooks/use-home-sidebar-preferences";
import { useWideHome } from "../hooks/use-wide-home";

const WIDGETS = [
  ["birthdays", "생일"],
  ["meal", "급식"],
  ["timetable", "시간표"],
] as const;

export function HomeSidebarSettings() {
  const wide = useWideHome();
  const [preferences, update] = useHomeSidebarPreferences();
  const id = useId();

  if (!wide) return null;

  return (
    <FieldGroup className="gap-0">
      <Field orientation="horizontal" className="px-4 py-3">
        <FieldContent>
          <FieldLabel htmlFor={id}>홈 우측 사이드바</FieldLabel>
          <FieldDescription>
            이 브라우저의 데스크톱 홈에 적용됩니다.
          </FieldDescription>
        </FieldContent>
        <Switch
          id={id}
          checked={preferences.enabled}
          onCheckedChange={(enabled) => update("enabled", enabled)}
        />
      </Field>
      {preferences.enabled
        ? WIDGETS.map(([key, label]) => (
            <Field
              key={key}
              orientation="horizontal"
              className="py-3 pr-4 pl-8"
            >
              <FieldLabel htmlFor={`${id}-${key}`}>{label}</FieldLabel>
              <Switch
                id={`${id}-${key}`}
                checked={preferences[key]}
                onCheckedChange={(enabled) => update(key, enabled)}
              />
            </Field>
          ))
        : null}
    </FieldGroup>
  );
}
