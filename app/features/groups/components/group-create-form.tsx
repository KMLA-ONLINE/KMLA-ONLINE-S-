import { ChevronLeftIcon } from "lucide-react";
import { useRef, useState } from "react";
import { Form, Link } from "react-router";

import { GroupConfirmDialog } from "~/features/groups/components/group-confirm-dialog";
import {
  getGroupJoinPolicyLabel,
  getGroupKindLabel,
} from "~/features/groups/model/format";
import type {
  CreateGroupErrors,
  CreateGroupValues,
  GroupJoinPolicy,
  GroupKind,
} from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import { Card, CardContent } from "~/shared/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

const DEFAULT_VALUES: CreateGroupValues = {
  kind: "unofficial",
  name: "",
  description: "",
  slug: "",
  joinPolicy: "invite_only",
  identityPolicy: "optional_anonymous",
  postingPolicy: "members",
};

export function GroupCreateForm({
  canCreateOfficial,
  values = DEFAULT_VALUES,
  errors = {},
  pending,
}: {
  canCreateOfficial: boolean;
  values?: CreateGroupValues;
  errors?: CreateGroupErrors;
  pending: boolean;
}) {
  const [kind, setKind] = useState<GroupKind>(values.kind);
  const [joinPolicy, setJoinPolicy] = useState<GroupJoinPolicy>(
    values.joinPolicy,
  );
  const customSlugAllowed = joinPolicy !== "invite_only";
  const formRef = useRef<HTMLFormElement>(null);
  const confirmedRef = useRef(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmName, setConfirmName] = useState("");

  /**
   * 확인 dialog를 거치지 않은 제출은 막고 dialog를 연다. 브라우저 기본 검증이
   * submit 이벤트보다 먼저 돌기 때문에, 필수 입력이 비어 있으면 dialog가 열리지 않는다.
   */
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }

    event.preventDefault();
    const name = new FormData(event.currentTarget).get("name");
    setConfirmName(typeof name === "string" ? name.trim() : "");
    setConfirmOpen(true);
  }

  function confirmCreate() {
    confirmedRef.current = true;
    setConfirmOpen(false);
    formRef.current?.requestSubmit();
  }

  function changeKind(nextKind: GroupKind) {
    setKind(nextKind);
    if (nextKind === "official" && joinPolicy === "invite_only") {
      setJoinPolicy("open");
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 pb-3 md:py-0">
      <div className="hidden flex-col gap-2 md:flex">
        <Link
          to="/groups"
          className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeftIcon aria-hidden className="size-4" />
          그룹
        </Link>
        <h1 className="text-2xl font-semibold">그룹 만들기</h1>
      </div>

      <Form
        ref={formRef}
        method="post"
        className="flex flex-col gap-4"
        onSubmit={handleSubmit}
      >
        {errors.form ? (
          <div className="px-4 md:px-0">
            <FieldError>{errors.form}</FieldError>
          </div>
        ) : null}

        {canCreateOfficial ? (
          <SectionCard>
            <FieldSet>
              <FieldLegend>종류</FieldLegend>
              <Field data-invalid={Boolean(errors.kind)}>
                <FieldLabel htmlFor="group-kind">그룹 종류</FieldLabel>
                <NativeSelect
                  id="group-kind"
                  name="kind"
                  value={kind}
                  onChange={(event) =>
                    changeKind(event.target.value as GroupKind)
                  }
                  disabled={pending}
                  aria-invalid={Boolean(errors.kind)}
                >
                  <NativeSelectOption value="unofficial">
                    비공식 그룹
                  </NativeSelectOption>
                  <NativeSelectOption value="official">
                    공식 그룹
                  </NativeSelectOption>
                </NativeSelect>
                <FieldDescription>
                  공식 그룹은 승인된 재학생이 자동으로 가입합니다.
                </FieldDescription>
                <FieldError>{errors.kind}</FieldError>
              </Field>
            </FieldSet>
          </SectionCard>
        ) : (
          <input type="hidden" name="kind" value="unofficial" />
        )}

        <SectionCard>
          <FieldSet>
            <FieldLegend>기본 정보</FieldLegend>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.name)}>
                <FieldLabel htmlFor="group-name">그룹 이름</FieldLabel>
                <TextField
                  id="group-name"
                  name="name"
                  defaultValue={values.name}
                  maxLength={50}
                  required
                  disabled={pending}
                  aria-invalid={Boolean(errors.name)}
                  placeholder="예: 30기 사진 동아리"
                  autoComplete="off"
                />
                <FieldError>{errors.name}</FieldError>
              </Field>

              <Field data-invalid={Boolean(errors.description)}>
                <FieldLabel htmlFor="group-description">그룹 설명</FieldLabel>
                <Textarea
                  id="group-description"
                  name="description"
                  defaultValue={values.description}
                  maxLength={2000}
                  rows={4}
                  disabled={pending}
                  aria-invalid={Boolean(errors.description)}
                  placeholder="이 그룹이 무엇을 하는 곳인지 적어주세요."
                  autoComplete="off"
                />
                <FieldError>{errors.description}</FieldError>
              </Field>
            </FieldGroup>
          </FieldSet>
        </SectionCard>

        <SectionCard>
          <FieldSet>
            <FieldLegend>참여 방식</FieldLegend>
            <FieldGroup>
              <Field data-invalid={Boolean(errors.joinPolicy)}>
                <FieldLabel htmlFor="join-policy">가입 정책</FieldLabel>
                <NativeSelect
                  id="join-policy"
                  name="joinPolicy"
                  value={joinPolicy}
                  onChange={(event) =>
                    setJoinPolicy(event.target.value as GroupJoinPolicy)
                  }
                  disabled={pending}
                  aria-invalid={Boolean(errors.joinPolicy)}
                >
                  <NativeSelectOption value="invite_only">
                    비공개 · 초대 전용
                  </NativeSelectOption>
                  <NativeSelectOption value="request">
                    공개 · 승인 가입
                  </NativeSelectOption>
                  <NativeSelectOption value="open">공개</NativeSelectOption>
                </NativeSelect>
                <FieldError>{errors.joinPolicy}</FieldError>
              </Field>

              {customSlugAllowed ? (
                <Field data-invalid={Boolean(errors.slug)}>
                  <FieldLabel htmlFor="group-slug">그룹 주소 (선택)</FieldLabel>
                  <div className="flex items-center gap-1">
                    <span className="shrink-0 text-sm text-muted-foreground">
                      /groups/
                    </span>
                    <Input
                      id="group-slug"
                      name="slug"
                      type="text"
                      defaultValue={values.slug}
                      minLength={4}
                      maxLength={15}
                      pattern="[a-z0-9][a-z0-9-]{2,13}[a-z0-9]"
                      placeholder="makers-lab"
                      disabled={pending}
                      aria-invalid={Boolean(errors.slug)}
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                  <FieldDescription>
                    비워 두면 임의 주소를 만듭니다. 영문 소문자, 숫자,
                    하이픈으로 4~15자입니다.
                  </FieldDescription>
                  <FieldError>{errors.slug}</FieldError>
                </Field>
              ) : (
                <p className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                  비공개 그룹은 임의 주소를 사용합니다.
                </p>
              )}
            </FieldGroup>
          </FieldSet>
        </SectionCard>

        <SectionCard>
          <FieldSet>
            <FieldLegend>활동 정책</FieldLegend>
            <FieldGroup className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={Boolean(errors.identityPolicy)}>
                <FieldLabel htmlFor="identity-policy">활동 신원</FieldLabel>
                <NativeSelect
                  id="identity-policy"
                  name="identityPolicy"
                  defaultValue={values.identityPolicy}
                  disabled={pending}
                  aria-invalid={Boolean(errors.identityPolicy)}
                >
                  <NativeSelectOption value="identified">
                    실명만
                  </NativeSelectOption>
                  <NativeSelectOption value="optional_anonymous">
                    작성할 때 선택
                  </NativeSelectOption>
                </NativeSelect>
                <FieldError>{errors.identityPolicy}</FieldError>
              </Field>
              <Field data-invalid={Boolean(errors.postingPolicy)}>
                <FieldLabel htmlFor="posting-policy">글쓰기</FieldLabel>
                <NativeSelect
                  id="posting-policy"
                  name="postingPolicy"
                  defaultValue={values.postingPolicy}
                  disabled={pending}
                  aria-invalid={Boolean(errors.postingPolicy)}
                >
                  <NativeSelectOption value="members">
                    모든 멤버
                  </NativeSelectOption>
                  <NativeSelectOption value="staff">
                    운영진만
                  </NativeSelectOption>
                </NativeSelect>
                <FieldError>{errors.postingPolicy}</FieldError>
              </Field>
            </FieldGroup>
          </FieldSet>
        </SectionCard>

        <div className="flex justify-end gap-2 px-4 md:px-0">
          <Button
            variant="ghost"
            nativeButton={false}
            render={<Link to="/groups" />}
          >
            취소
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? <Spinner data-icon="inline-start" /> : null}
            그룹 만들기
          </Button>
        </div>
      </Form>

      <GroupConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={`'${confirmName}' 그룹을 만들까요?`}
        description={`그룹 주소는 후에 수정할 수 없습니다.${
          joinPolicy === "invite_only"
            ? " 공개 전환 후에는 비공개로 변경할 수 없습니다."
            : " 공개 그룹은 만든 뒤 비공개로 변경할 수 없습니다."
        }`}
        details={
          <dl className="flex flex-col gap-1 text-sm">
            <SummaryRow label="종류">{getGroupKindLabel(kind)}</SummaryRow>
            <SummaryRow label="가입 정책">
              {getGroupJoinPolicyLabel(joinPolicy)}
            </SummaryRow>
          </dl>
        }
        confirmLabel="만들기"
        pending={pending}
        onConfirm={confirmCreate}
      />
    </div>
  );
}

function SummaryRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <Card
      size="sm"
      className="rounded-none shadow-none sm:rounded-xl sm:shadow-xs"
    >
      <CardContent>{children}</CardContent>
    </Card>
  );
}
