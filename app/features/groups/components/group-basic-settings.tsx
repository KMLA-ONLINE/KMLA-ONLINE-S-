import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import {
  ActionStatus,
  FormActions,
  SettingsHidden,
} from "~/features/groups/components/group-settings-form";
import type { GroupDetail } from "~/features/groups/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "~/shared/ui/card";
import { Field, FieldLabel } from "~/shared/ui/field";
import { TextField } from "~/shared/ui/text-field";
import { Textarea } from "~/shared/ui/textarea";

export function BasicInfoCard({ group }: { group: GroupDetail }) {
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [editing, setEditing] = useState(false);
  const [pendingForm, setPendingForm] = useState<FormData | null>(null);
  const submitted = useRef(false);
  const pending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !submitted.current) return;
    submitted.current = false;
    if (fetcher.data?.ok) queueMicrotask(() => setEditing(false));
  }, [fetcher.data, fetcher.state]);

  return (
    <Card className="rounded-none border-x-0 md:rounded-xl md:border">
      <CardHeader className="border-b">
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle>기본 정보</CardTitle>
          </div>
          {!editing ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              aria-label="기본 정보 편집"
              disabled={pending}
              onClick={() => setEditing(true)}
            >
              편집
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent>
        {editing ? (
          <fetcher.Form
            method="post"
            className="space-y-5"
            onSubmit={(event) => {
              event.preventDefault();
              setPendingForm(new FormData(event.currentTarget));
            }}
          >
            <SettingsHidden group={group} omit="basic" />
            <Field>
              <FieldLabel htmlFor="group-name">그룹 이름</FieldLabel>
              <TextField
                id="group-name"
                name="name"
                defaultValue={group.name}
                maxLength={50}
                autoComplete="off"
                required
              />
            </Field>
            <Field>
              <div className="flex items-center justify-between gap-3">
                <FieldLabel htmlFor="group-description">그룹 설명</FieldLabel>
                <span className="text-xs text-muted-foreground">
                  최대 2,000자
                </span>
              </div>
              <Textarea
                id="group-description"
                name="description"
                defaultValue={group.description}
                maxLength={2000}
                rows={5}
                className="resize-y"
              />
            </Field>
            <FormActions pending={pending} cancel={() => setEditing(false)} />
          </fetcher.Form>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[9rem_minmax(0,1fr)]">
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                그룹 이름
              </p>
              <p className="mt-1 font-medium break-words">{group.name}</p>
            </div>
            <div>
              <p className="text-xs font-medium tracking-wide text-muted-foreground">
                소개
              </p>
              <p className="mt-1 text-sm leading-6 whitespace-pre-wrap text-foreground/80">
                {group.description || "아직 그룹 설명이 없습니다."}
              </p>
            </div>
          </div>
        )}
        <ActionStatus data={fetcher.data} />
      </CardContent>
      {pendingForm ? (
        <ConfirmDialog
          title="기본 정보 저장"
          description="변경한 기본 정보를 저장할까요?"
          confirmLabel="저장"
          pending={pending}
          onCancel={() => setPendingForm(null)}
          onConfirm={() => {
            submitted.current = true;
            void fetcher.submit(pendingForm, { method: "post" });
            setPendingForm(null);
          }}
        />
      ) : null}
    </Card>
  );
}
