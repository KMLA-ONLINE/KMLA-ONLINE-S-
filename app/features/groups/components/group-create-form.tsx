import { useState } from "react";
import { Form } from "react-router";

import type {
  CreateGroupErrors,
  CreateGroupValues,
  GroupJoinPolicy,
  GroupKind,
} from "~/features/groups/model/types";
import { Button } from "~/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "~/shared/ui/card";
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

  function changeKind(nextKind: GroupKind) {
    setKind(nextKind);
    if (nextKind === "official" && joinPolicy === "invite_only") {
      setJoinPolicy("open");
    }
  }

  return (
    <div className="px-4 py-6 md:px-0 md:py-8">
      <Card className="mx-auto max-w-2xl">
        <CardHeader>
          <CardTitle className="text-xl">
            새 그룹의 기본 정보를 정하세요
          </CardTitle>
          <CardDescription>
            그룹 종류와 주소는 만든 뒤 변경할 수 없습니다.
          </CardDescription>
        </CardHeader>
        <Form method="post">
          <CardContent className="flex flex-col gap-8">
            {errors.form ? <FieldError>{errors.form}</FieldError> : null}

            <FieldSet>
              <FieldLegend>기본 정보</FieldLegend>
              <FieldGroup>
                {canCreateOfficial ? (
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
                ) : (
                  <input type="hidden" name="kind" value="unofficial" />
                )}

                <Field data-invalid={Boolean(errors.name)}>
                  <FieldLabel htmlFor="group-name">그룹 이름</FieldLabel>
                  <Input
                    id="group-name"
                    name="name"
                    defaultValue={values.name}
                    maxLength={50}
                    required
                    disabled={pending}
                    aria-invalid={Boolean(errors.name)}
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
                    rows={5}
                    disabled={pending}
                    aria-invalid={Boolean(errors.description)}
                  />
                  <FieldError>{errors.description}</FieldError>
                </Field>
              </FieldGroup>
            </FieldSet>

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
                      공개 · 승인 후 가입
                    </NativeSelectOption>
                    <NativeSelectOption value="open">
                      공개 · 바로 가입
                    </NativeSelectOption>
                  </NativeSelect>
                  <FieldError>{errors.joinPolicy}</FieldError>
                </Field>

                {customSlugAllowed ? (
                  <Field data-invalid={Boolean(errors.slug)}>
                    <FieldLabel htmlFor="group-slug">
                      그룹 주소 (선택)
                    </FieldLabel>
                    <Input
                      id="group-slug"
                      name="slug"
                      defaultValue={values.slug}
                      minLength={3}
                      maxLength={50}
                      pattern="[a-z0-9][a-z0-9-]{1,48}[a-z0-9]"
                      placeholder="makers-lab"
                      disabled={pending}
                      aria-invalid={Boolean(errors.slug)}
                    />
                    <FieldDescription>
                      비워 두면 임의 주소를 만듭니다. 영문 소문자, 숫자,
                      하이픈만 사용할 수 있습니다.
                    </FieldDescription>
                    <FieldError>{errors.slug}</FieldError>
                  </Field>
                ) : (
                  <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
                    초대 전용 그룹은 외부에서 추측하기 어려운 임의 주소를
                    사용합니다.
                  </div>
                )}
              </FieldGroup>
            </FieldSet>

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
                    <NativeSelectOption value="always_anonymous">
                      항상 익명
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
          </CardContent>
          <CardFooter className="mt-8 justify-end border-t">
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? <Spinner data-icon="inline-start" /> : null}
              그룹 만들기
            </Button>
          </CardFooter>
        </Form>
      </Card>
    </div>
  );
}
