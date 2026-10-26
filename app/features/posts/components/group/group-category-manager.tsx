import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import type { GroupCategory } from "~/features/posts/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { useT } from "~/shared/i18n";
import { Button } from "~/shared/ui/button";
import { TextField } from "~/shared/ui/text-field";

export function GroupCategoryManager({
  groupId,
  categories,
}: {
  groupId: string;
  categories: GroupCategory[];
}) {
  const t = useT();
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [newCategoryName, setNewCategoryName] = useState("");
  const submittedCreate = useRef(false);
  const [pendingChange, setPendingChange] = useState<{
    data: FormData;
    title: string;
    description: string;
    confirmLabel: string;
    destructive?: boolean;
  } | null>(null);
  const pending = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !submittedCreate.current) return;
    submittedCreate.current = false;
    if (fetcher.data?.ok) queueMicrotask(() => setNewCategoryName(""));
  }, [fetcher.data, fetcher.state]);

  const holdSubmit = (
    event: React.FormEvent<HTMLFormElement>,
    title: string,
    description: string,
    confirmLabel: string,
  ) => {
    event.preventDefault();
    const submitter =
      event.nativeEvent instanceof SubmitEvent
        ? event.nativeEvent.submitter
        : null;
    const data = new FormData(event.currentTarget);
    if (submitter instanceof HTMLButtonElement && submitter.name) {
      data.set(submitter.name, submitter.value);
    }
    setPendingChange({ data, title, description, confirmLabel });
  };

  return (
    <section className="overflow-hidden rounded-none border-y bg-card shadow-xs ring-foreground/10 md:rounded-xl md:border md:ring-1">
      <header className="border-b px-4 py-4 sm:px-6 sm:py-5">
        <h2 className="font-heading text-base font-medium">
          {t("게시물 카테고리")}
        </h2>
      </header>
      <fetcher.Form
        method="post"
        className="flex gap-2 px-4 pt-4 sm:px-6 sm:pt-5"
        onSubmit={(event) =>
          holdSubmit(
            event,
            t("카테고리 생성"),
            t("입력한 이름으로 카테고리를 생성할까요?"),
            t("생성"),
          )
        }
      >
        <input type="hidden" name="intent" value="create-category" />
        <input type="hidden" name="groupId" value={groupId} />
        <TextField
          name="name"
          value={newCategoryName}
          onChange={(event) => setNewCategoryName(event.target.value)}
          maxLength={30}
          required
          aria-label={t("새 카테고리 이름")}
          placeholder={t("새 카테고리 이름…")}
          autoComplete="off"
        />
        <Button type="submit" disabled={pending}>
          <PlusIcon /> {t("추가")}
        </Button>
      </fetcher.Form>
      <div className="mt-4 px-4 pb-4 sm:px-6 sm:pb-5">
        {categories.length === 0 ? (
          <p className="rounded-lg px-4 py-8 text-center text-sm text-muted-foreground">
            {t("아직 카테고리가 없습니다.")}
          </p>
        ) : null}
        {categories.map((category, index) => (
          <fetcher.Form
            key={category.id}
            method="post"
            className="grid grid-cols-[minmax(0,1fr)_repeat(4,auto)] items-center gap-1.5 border-b py-2 last:border-b-0"
            onSubmit={(event) => {
              const submitter = event.nativeEvent.submitter;
              if (!(submitter instanceof HTMLButtonElement)) return;
              if (submitter.value === "rename-category") {
                holdSubmit(
                  event,
                  t("카테고리 저장"),
                  t("‘{name}’ 카테고리의 변경 사항을 저장할까요?", {
                    name: category.name,
                  }),
                  t("저장"),
                );
                return;
              }
              if (submitter.value === "delete-category") {
                event.preventDefault();
                const data = new FormData(event.currentTarget);
                data.set(submitter.name, submitter.value);
                setPendingChange({
                  data,
                  title: t("카테고리 삭제"),
                  description: t(
                    "‘{name}’ 카테고리를 삭제할까요? 기존 게시물은 미분류로 남습니다.",
                    { name: category.name },
                  ),
                  confirmLabel: t("삭제"),
                  destructive: true,
                });
              }
            }}
          >
            <input type="hidden" name="groupId" value={groupId} />
            <input type="hidden" name="categoryId" value={category.id} />
            <input type="hidden" name="position" value={category.position} />
            <TextField
              name="name"
              defaultValue={category.name}
              maxLength={30}
              required
              aria-label={t("{name} 이름", { name: category.name })}
              className="col-span-full sm:col-span-1"
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              name="intent"
              value="rename-category"
              disabled={pending}
            >
              {t("저장")}
            </Button>
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              name="intent"
              value="move-category-up"
              aria-label={t("{name} 위로", { name: category.name })}
              disabled={pending || index === 0}
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              name="intent"
              value="move-category-down"
              aria-label={t("{name} 아래로", { name: category.name })}
              disabled={pending || index === categories.length - 1}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="submit"
              size="icon-sm"
              variant="destructive"
              aria-label={t("{name} 삭제", { name: category.name })}
              name="intent"
              value="delete-category"
              disabled={pending}
            >
              <Trash2Icon />
            </Button>
          </fetcher.Form>
        ))}
      </div>
      {fetcher.data?.error ? (
        <p
          role="alert"
          className="px-4 pb-4 text-sm text-destructive sm:px-6 sm:pb-5"
        >
          {fetcher.data.error}
        </p>
      ) : null}
      {pendingChange ? (
        <ConfirmDialog
          title={pendingChange.title}
          description={pendingChange.description}
          confirmLabel={pendingChange.confirmLabel}
          destructive={pendingChange.destructive}
          pending={pending}
          onCancel={() => setPendingChange(null)}
          onConfirm={() => {
            submittedCreate.current =
              pendingChange.data.get("intent") === "create-category";
            void fetcher.submit(pendingChange.data, { method: "post" });
            setPendingChange(null);
          }}
        />
      ) : null}
    </section>
  );
}
