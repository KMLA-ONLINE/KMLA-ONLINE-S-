import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

import { ADMIN_CONTACT_LIMIT, type AdminContact } from "~/features/support";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
import { Field, FieldError, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Spinner } from "~/shared/ui/spinner";
import { TextField } from "~/shared/ui/text-field";

export interface AdminContactsActionResult {
  ok?: boolean;
  error?: string;
  rowErrors?: Record<number, string>;
}

interface Row extends AdminContact {
  key: number;
}

let nextKey = 0;
const toRow = (contact: AdminContact): Row => ({ ...contact, key: nextKey++ });

/** 목록 전체를 한 번에 바꾼다. 저장 결과는 다음 편집을 시작하면 지운다. */
export function AdminContactsScreen({
  contacts,
}: {
  contacts: AdminContact[];
}) {
  const t = useT();
  const fetcher = useFetcher<AdminContactsActionResult>();
  const [rows, setRows] = useState(() => contacts.map(toRow));
  const [dirty, setDirty] = useState(false);
  const busy = fetcher.state !== "idle";
  const result = dirty || busy ? undefined : fetcher.data;
  const rowErrors = result?.rowErrors ?? {};

  const update = (next: Row[]) => {
    setRows(next);
    setDirty(true);
  };
  const patch = (key: number, change: Partial<AdminContact>) =>
    update(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  const move = (index: number, offset: -1 | 1) => {
    const next = [...rows];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    update(next);
  };
  const save = () => {
    setDirty(false);
    void fetcher.submit(
      {
        contacts: JSON.stringify(
          rows.map(({ kind, label, value }) => ({ kind, label, value })),
        ),
      },
      { method: "post" },
    );
  };

  return (
    <div className="space-y-6 px-0 py-4 md:px-4">
      <Card className="rounded-none md:rounded-xl">
        <CardHeader>
          <CardTitle>{t("관리자 연락처")}</CardTitle>
          <CardDescription>
            {t(
              "로그인에 실패했을 때, 회원가입 인증 단계, 승인 대기, 가입 차단 화면에서 볼 수 있습니다. 로그인하지 않은 사람도 볼 수 있으니 개인 연락처 대신 공용 메일이나 오픈채팅 링크를 넣어 주세요.",
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {rows.length ? (
            <ol className="space-y-4">
              {rows.map((row, index) => (
                <li
                  key={row.key}
                  className="space-y-3 rounded-xl p-4 ring-1 ring-foreground/10"
                >
                  <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
                    <Field>
                      <FieldLabel htmlFor={`contact-kind-${row.key}`}>
                        {t("종류")}
                      </FieldLabel>
                      <NativeSelect
                        id={`contact-kind-${row.key}`}
                        value={row.kind}
                        onChange={(event) =>
                          patch(row.key, {
                            kind: event.target.value as AdminContact["kind"],
                          })
                        }
                      >
                        <NativeSelectOption value="link">
                          {t("링크")}
                        </NativeSelectOption>
                        <NativeSelectOption value="email">
                          {t("이메일")}
                        </NativeSelectOption>
                      </NativeSelect>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor={`contact-label-${row.key}`}>
                        {t("이름")}
                      </FieldLabel>
                      <TextField
                        id={`contact-label-${row.key}`}
                        value={row.label}
                        placeholder={t("예: 학생회 오픈채팅")}
                        onChange={(event) =>
                          patch(row.key, { label: event.target.value })
                        }
                      />
                    </Field>
                  </div>
                  <Field data-invalid={Boolean(rowErrors[index])}>
                    <FieldLabel htmlFor={`contact-value-${row.key}`}>
                      {row.kind === "email" ? t("이메일 주소") : t("링크 주소")}
                    </FieldLabel>
                    <Input
                      id={`contact-value-${row.key}`}
                      type={row.kind === "email" ? "email" : "url"}
                      value={row.value}
                      placeholder={
                        row.kind === "email"
                          ? "name@example.com"
                          : "https://open.kakao.com/..."
                      }
                      aria-invalid={Boolean(rowErrors[index])}
                      onChange={(event) =>
                        patch(row.key, { value: event.target.value })
                      }
                    />
                    <FieldError>{rowErrors[index]}</FieldError>
                  </Field>
                  <div className="flex justify-end gap-1">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("{n}번 연락처 위로", { n: index + 1 })}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUpIcon />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("{n}번 연락처 아래로", { n: index + 1 })}
                      disabled={index === rows.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDownIcon />
                    </Button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      aria-label={t("{n}번 연락처 삭제", { n: index + 1 })}
                      onClick={() =>
                        update(rows.filter((item) => item.key !== row.key))
                      }
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">
              {t(
                "등록된 연락처가 없습니다. 연락처가 없으면 문의 영역이 표시되지 않습니다.",
              )}
            </p>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={rows.length >= ADMIN_CONTACT_LIMIT}
            onClick={() =>
              update([...rows, toRow({ kind: "link", label: "", value: "" })])
            }
          >
            <PlusIcon data-icon="inline-start" />
            {t("연락처 추가 ({count}/{limit})", {
              count: rows.length,
              limit: ADMIN_CONTACT_LIMIT,
            })}
          </Button>
        </CardContent>
      </Card>
      <div className="flex items-center justify-end gap-3 px-4 md:px-0">
        {result?.error ? (
          <p role="alert" className="text-sm text-destructive">
            {result.error}
          </p>
        ) : null}
        {result?.ok ? (
          <p role="status" className="text-sm text-muted-foreground">
            {t("저장했습니다.")}
          </p>
        ) : null}
        <Button type="button" disabled={busy} onClick={save}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {t("저장")}
        </Button>
      </div>
    </div>
  );
}
