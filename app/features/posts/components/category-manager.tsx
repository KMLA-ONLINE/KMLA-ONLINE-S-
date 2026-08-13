import { ArrowDownIcon, ArrowUpIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useFetcher } from "react-router";

import type { GroupCategory } from "~/features/posts/model/types";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

export function CategoryManager({
  groupId,
  categories,
}: {
  groupId: string;
  categories: GroupCategory[];
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const [deleteTarget, setDeleteTarget] = useState<GroupCategory | null>(null);
  const pending = fetcher.state !== "idle";

  return (
    <section className="rounded-none border-y bg-card p-4 md:rounded-xl md:border">
      <h2 className="font-semibold">카테고리 관리</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        게시물 분류를 추가하고 표시 순서를 정할 수 있습니다.
      </p>
      <fetcher.Form method="post" className="mt-4 flex gap-2">
        <input type="hidden" name="intent" value="create-category" />
        <input type="hidden" name="groupId" value={groupId} />
        <Input
          name="name"
          maxLength={30}
          required
          aria-label="새 카테고리 이름"
          placeholder="새 카테고리"
        />
        <Button type="submit" disabled={pending}>
          <PlusIcon /> 추가
        </Button>
      </fetcher.Form>
      <div className="mt-4 divide-y">
        {categories.map((category, index) => (
          <fetcher.Form
            key={category.id}
            method="post"
            className="flex items-center gap-2 py-2"
          >
            <input type="hidden" name="categoryId" value={category.id} />
            <input type="hidden" name="position" value={category.position} />
            <Input
              name="name"
              defaultValue={category.name}
              maxLength={30}
              required
              aria-label={`${category.name} 이름`}
            />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              name="intent"
              value="rename-category"
              disabled={pending}
            >
              저장
            </Button>
            <Button
              type="submit"
              size="icon-sm"
              variant="ghost"
              name="intent"
              value="move-category-up"
              aria-label={`${category.name} 위로`}
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
              aria-label={`${category.name} 아래로`}
              disabled={pending || index === categories.length - 1}
            >
              <ArrowDownIcon />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label={`${category.name} 삭제`}
              disabled={pending}
              onClick={() => setDeleteTarget(category)}
            >
              <Trash2Icon />
            </Button>
          </fetcher.Form>
        ))}
      </div>
      {fetcher.data?.error ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {fetcher.data.error}
        </p>
      ) : null}
      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>카테고리 삭제</DialogTitle>
            <DialogDescription>
              ‘{deleteTarget?.name}’ 카테고리를 삭제할까요? 기존 게시물은
              미분류로 남습니다.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              취소
            </DialogClose>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!deleteTarget) return;
                void fetcher.submit(
                  { intent: "delete-category", categoryId: deleteTarget.id },
                  { method: "post" },
                );
                setDeleteTarget(null);
              }}
            >
              {pending ? <Spinner /> : null} 삭제
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
