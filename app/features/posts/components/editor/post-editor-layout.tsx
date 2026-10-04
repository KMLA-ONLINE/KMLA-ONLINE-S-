import { ArrowLeftIcon } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";

import type { PostSaveProgress } from "~/features/posts/model/types";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

export function PostEditorLayout({
  mode,
  subtitle,
  saving,
  preparingCount,
  progress,
  onClose,
  formProps,
  children,
}: {
  mode: "create" | "edit";
  subtitle: string;
  saving: boolean;
  preparingCount: number;
  progress: PostSaveProgress | null;
  onClose: () => void;
  formProps: Omit<ComponentProps<"form">, "children" | "className">;
  children: ReactNode;
}) {
  const progressLabel =
    progress === "uploading"
      ? "첨부 업로드 중"
      : progress === "publishing"
        ? "게시 중"
        : "저장 중";

  return (
    <div className="fixed inset-0 z-50 flex h-dvh flex-col bg-background">
      {/* 첨부 저장은 브라우저 I/O를 조율하므로 route action이 아니라 각 편집기가 처리한다. */}
      <form {...formProps} className="flex min-h-0 flex-1 flex-col">
        <header className="shrink-0 border-b bg-background pt-[env(safe-area-inset-top)] md:border-b-0 md:bg-muted/40">
          <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-3 sm:px-6 md:border-x md:border-b md:bg-background md:shadow-sm">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="작성 화면 닫기"
              onClick={onClose}
            >
              <ArrowLeftIcon />
            </Button>
            <div className="min-w-0 flex-1">
              <h1 className="truncate font-semibold">
                {mode === "create" ? "새 게시물" : "게시물 수정"}
              </h1>
              <p className="truncate text-xs text-muted-foreground">
                {subtitle}
              </p>
            </div>
            <Button type="submit" disabled={saving || preparingCount > 0}>
              {saving ? <Spinner /> : null}{" "}
              {preparingCount > 0
                ? "파일 준비 중"
                : saving
                  ? progressLabel
                  : mode === "create"
                    ? "게시"
                    : "저장"}
            </Button>
          </div>
        </header>

        {/* 양쪽 scrollbar gutter가 헤더와 스크롤 본문의 수평 정렬을 유지한다. */}
        <main className="min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto md:bg-muted/40">
          <div className="mx-auto flex min-h-full w-full max-w-5xl flex-col px-4 py-5 sm:px-6 sm:py-8 md:border-x md:bg-background md:shadow-sm">
            {children}
          </div>
        </main>
      </form>
    </div>
  );
}

/** 편집기의 한 항목. 오류 문구를 입력 아래 같은 자리에 붙이려고 두 편집기가 함께 쓴다. */
export function PostFormField({
  className,
  error,
  children,
}: {
  className?: string;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
