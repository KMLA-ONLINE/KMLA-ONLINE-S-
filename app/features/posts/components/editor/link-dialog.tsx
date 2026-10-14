import { useRef, useState, type FormEvent, type RefObject } from "react";

import {
  isSafePostLink,
  normalizePostLinkInput,
} from "~/features/posts/model/markdown";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Field, FieldError, FieldLabel } from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { TextField } from "~/shared/ui/text-field";

export interface LinkDraft {
  /** 편집기에서 선택해 둔 글자. 비어 있으면 커서 자리에 새로 넣는다. */
  text: string;
  /** 커서가 이미 링크 안에 있으면 그 주소. */
  href: string;
}

/**
 * 본문 링크 입력 창. 글자를 먼저 고르지 않으면 링크 버튼이 아무것도 하지 않던 탓에 쓰는 법을
 * 모르는 사람이 많았다. 고른 글자가 있으면 주소만 받아 그 글자에 걸고, 없으면 표시할 글자도
 * 함께 받아 커서 자리에 넣는다.
 */
export function LinkDialog({
  draft,
  onOpenChange,
  onSubmit,
}: {
  draft: LinkDraft | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (link: { text: string; href: string }) => void;
}) {
  const hrefRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog open={draft !== null} onOpenChange={onOpenChange}>
      {/* `autoFocus`는 `DialogContent`의 초기 포커스에 덮이므로 Base UI에 넘긴다. */}
      <DialogContent className="sm:max-w-md" initialFocus={hrefRef}>
        {/* 열 때마다 입력을 새 draft로 시작한다. */}
        {draft ? (
          <LinkForm
            key={`${draft.text}\n${draft.href}`}
            draft={draft}
            hrefRef={hrefRef}
            onCancel={() => onOpenChange(false)}
            onSubmit={onSubmit}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function LinkForm({
  draft,
  hrefRef,
  onCancel,
  onSubmit,
}: {
  draft: LinkDraft;
  hrefRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onSubmit: (link: { text: string; href: string }) => void;
}) {
  const hasSelection = draft.text.trim() !== "";
  const [text, setText] = useState(draft.text);
  const [href, setHref] = useState(draft.href);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // 창은 portal로 뜨지만 React 이벤트는 컴포넌트 트리를 따라 오른다. 막지 않으면 바깥 게시물
    // 폼의 onSubmit까지 불려 글이 저장된다.
    event.stopPropagation();
    const normalized = normalizePostLinkInput(href);
    if (!normalized) return;
    if (!isSafePostLink(normalized)) {
      setError("웹 주소(http, https)만 넣을 수 있어요.");
      return;
    }
    // 고른 글자는 손대지 않고 그대로 돌려준다. 앞뒤 공백까지 같아야 편집기가 mark만 더한다.
    onSubmit({
      text: hasSelection ? draft.text : text.trim() || normalized,
      href: normalized,
    });
  };

  return (
    <form noValidate onSubmit={submit} className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>링크</DialogTitle>
        {hasSelection ? (
          <DialogDescription className="line-clamp-2 break-all">
            {draft.text}
          </DialogDescription>
        ) : null}
      </DialogHeader>

      <Field data-invalid={Boolean(error)}>
        <FieldLabel htmlFor="post-link-href">주소</FieldLabel>
        <Input
          id="post-link-href"
          type="url"
          inputMode="url"
          ref={hrefRef}
          value={href}
          onChange={(event) => {
            setHref(event.target.value);
            setError(null);
          }}
          placeholder="https://example.com"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "post-link-error" : undefined}
          enterKeyHint="done"
        />
        {error ? <FieldError id="post-link-error">{error}</FieldError> : null}
      </Field>

      {/* 고른 글자가 있으면 그 글자에 건다. 바꿀 일이 드물어 칸을 두지 않는다. */}
      {hasSelection ? null : (
        <Field>
          <FieldLabel htmlFor="post-link-text">표시할 글자 (선택)</FieldLabel>
          <TextField
            id="post-link-text"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="비워 두면 주소가 그대로 보여요"
          />
        </Field>
      )}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          취소
        </Button>
        <Button type="submit" disabled={!href.trim()}>
          확인
        </Button>
      </DialogFooter>
    </form>
  );
}
