import { ChevronDownIcon, SendHorizontalIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import {
  COMMENT_MAX_LENGTH,
  countCommentGraphemes,
  normalizeCommentBody,
  validateCommentBody,
} from "~/features/posts/model/comment-text";
import type { PostIdentity } from "~/features/posts/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";
import { Spinner } from "~/shared/ui/spinner";
import { Textarea } from "~/shared/ui/textarea";

const IDENTITY_LABEL: Record<PostIdentity, string> = {
  identified: "실명",
  anonymous: "익명",
  staff: "운영진",
};

const IDENTITY_CONFIRMATION: Record<PostIdentity, string> = {
  identified:
    "이후 작성하는 댓글에 실명과 프로필이 표시됩니다. 실명으로 바꿀까요?",
  anonymous:
    "이후 작성하는 댓글은 작성자의 이름을 표시하지 않습니다. 익명으로 바꿀까요?",
  staff:
    "이후 작성하는 댓글은 그룹 운영진 명의로 표시됩니다. 운영진 명의로 바꿀까요?",
};

/** 남은 글자 수는 끝에 가까워질 때만 보여준다. 항상 띄우면 짧은 댓글에서 잡음이 된다. */
const COUNTER_THRESHOLD = COMMENT_MAX_LENGTH - 500;

export interface CommentReplyTarget {
  commentId: string;
  authorLabel: string;
}

/**
 * 게시물 상세 하단에 고정되는 입력창. 답글도 이 하나를 쓴다.
 *
 * 목록 중간에 입력기를 새로 띄우면 모바일에서 키보드가 그 자리를 덮고 스크롤이 튄다. 대신
 * 어디에 다는 중인지 배너로 밝힌다.
 *
 * 신원은 입력창 안 드롭다운으로 고르되 바꾸기 직전에 확인을 받는다. 등록마다 확인을 띄우면
 * `Enter` 한 번으로 등록되는 흐름(기능 명세 §9.1)이 무너지고, 확인 없이 바꾸게 두면 실명으로
 * 쓸 생각이던 댓글이 익명으로 나가는 사고를 되돌릴 수 없다.
 */
export function CommentComposer({
  identities,
  identity,
  onIdentityChange,
  replyTo,
  onCancelReply,
  onSubmit,
  pending = false,
  error,
  inputRef,
}: {
  identities: PostIdentity[];
  identity: PostIdentity;
  onIdentityChange: (next: PostIdentity) => void;
  replyTo: CommentReplyTarget | null;
  onCancelReply: () => void;
  onSubmit: (body: string) => void | Promise<unknown>;
  pending?: boolean;
  error?: string | null;
  /** 액션 바의 댓글 버튼이 입력창으로 보낼 수 있게 바깥에서 잡아 둘 수 있다. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
}) {
  const [draft, setDraft] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<PostIdentity | null>(
    null,
  );
  // 한글 조합 중의 `Enter`는 글자를 확정하는 키다. 이걸 등록으로 처리하면 "안녕하세"까지만
  // 쓴 댓글이 올라간다.
  const composing = useRef(false);
  const localRef = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? localRef;

  useEffect(() => {
    if (replyTo) input.current?.focus();
  }, [replyTo, input]);

  const length = countCommentGraphemes(draft);
  const overLimit = length > COMMENT_MAX_LENGTH;

  const submit = () => {
    if (pending) return;
    const reason = validateCommentBody(draft);
    if (reason) return setLocalError(reason);
    setLocalError(null);
    const body = normalizeCommentBody(draft);
    setDraft("");
    void onSubmit(body);
  };

  const keyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    if (composing.current || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const shown = localError ?? error;

  return (
    <>
      <div className="border-t bg-background p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        {replyTo ? (
          <div className="mb-2 flex items-center gap-2 rounded-md bg-muted px-2.5 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-muted-foreground">
              <span className="font-medium text-foreground">
                {replyTo.authorLabel}
              </span>
              님에게 답글
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="답글 취소"
              onClick={onCancelReply}
            >
              <XIcon className="size-3.5" />
            </Button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          {identities.length > 1 ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="shrink-0"
                    aria-label={`작성 신원: ${IDENTITY_LABEL[identity]}`}
                  />
                }
              >
                {IDENTITY_LABEL[identity]}
                <ChevronDownIcon className="size-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {identities.map((option) => (
                  <DropdownMenuItem
                    key={option}
                    disabled={option === identity}
                    onClick={() => setPendingIdentity(option)}
                  >
                    {IDENTITY_LABEL[option]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}

          <Textarea
            ref={input}
            rows={1}
            value={draft}
            aria-label="댓글 입력"
            placeholder="댓글을 입력하세요"
            className="max-h-32 min-h-9 resize-none py-1.5"
            onChange={(event) => {
              setDraft(event.target.value);
              if (localError) setLocalError(null);
            }}
            onCompositionStart={() => (composing.current = true)}
            onCompositionEnd={() => (composing.current = false)}
            onKeyDown={keyDown}
          />

          <Button
            type="button"
            size="icon"
            aria-label="댓글 등록"
            disabled={pending || overLimit || draft.trim() === ""}
            onClick={submit}
          >
            {pending ? <Spinner /> : <SendHorizontalIcon />}
          </Button>
        </div>

        <div className="mt-1 flex items-center gap-2 text-xs">
          {shown ? (
            <p role="alert" className="text-destructive">
              {shown}
            </p>
          ) : null}
          {length > COUNTER_THRESHOLD ? (
            <p
              className={cn(
                "ml-auto tabular-nums",
                overLimit ? "text-destructive" : "text-muted-foreground",
              )}
            >
              {length.toLocaleString("ko-KR")} /{" "}
              {COMMENT_MAX_LENGTH.toLocaleString("ko-KR")}
            </p>
          ) : null}
        </div>
      </div>

      {pendingIdentity ? (
        <ConfirmDialog
          title={`${IDENTITY_LABEL[pendingIdentity]}으로 작성`}
          description={IDENTITY_CONFIRMATION[pendingIdentity]}
          confirmLabel="바꾸기"
          onCancel={() => setPendingIdentity(null)}
          onConfirm={() => {
            onIdentityChange(pendingIdentity);
            setPendingIdentity(null);
          }}
        />
      ) : null}
    </>
  );
}
