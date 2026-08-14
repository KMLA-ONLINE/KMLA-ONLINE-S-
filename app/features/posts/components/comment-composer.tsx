import { ArrowLeftRightIcon, SendIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";

import {
  PostAnonymousAvatar,
  PostStaffAvatar,
} from "~/features/posts/components/post-author-avatar";
import {
  COMMENT_MAX_LENGTH,
  countCommentGraphemes,
  normalizeCommentBody,
  validateCommentBody,
} from "~/features/posts/model/comment-text";
import type { PostIdentity } from "~/features/posts/model/types";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "~/shared/ui/tooltip";

const IDENTITY_LABEL: Record<PostIdentity, string> = {
  identified: "실명",
  anonymous: "익명",
  staff: "운영진",
};

const IDENTITY_CONFIRMATION: Record<PostIdentity, string> = {
  identified: "이후 작성하는 댓글에 실명과 프로필이 표시됩니다.",
  anonymous: "이후 작성하는 댓글은 작성자의 이름을 표시하지 않습니다.",
  staff: "이후 작성하는 댓글은 그룹 운영진 명의로 표시됩니다.",
};

/** 남은 글자 수는 끝에 가까워질 때만 보여준다. 항상 띄우면 짧은 댓글에서 잡음이 된다. */
const COUNTER_THRESHOLD = COMMENT_MAX_LENGTH - 500;

/**
 * 입력 높이 상한. shadcn `Textarea`의 `field-sizing-content`는 글자마다 레이아웃을 다시
 * 계산해서 긴 댓글에서 눈에 띄게 밀린다. 메신저 입력기처럼 직접 재는 편이 가볍다.
 */
const MAX_HEIGHT = 120;

function resize(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  const next = Math.min(element.scrollHeight, MAX_HEIGHT);
  element.style.height = `${next}px`;
  element.style.overflowY =
    element.scrollHeight > MAX_HEIGHT ? "auto" : "hidden";
}

export interface CommentViewer {
  name: string | null;
  avatarUrl: string | null;
}

/**
 * 댓글 입력창. 하단 고정 입력과 각 댓글의 인라인 답글 입력이 같은 컴포넌트를 쓴다
 * (`className`으로 테두리와 여백만 바꾼다).
 *
 * 왼쪽 아바타가 곧 작성 신원이다. 눌러 다음 신원으로 넘어가되 바꾸기 직전에 확인을 받는다.
 * 등록마다 확인을 띄우면 `Enter` 한 번으로 등록되는 흐름(기능 명세 §9.1)이 무너지고, 확인 없이
 * 바꾸게 두면 실명으로 쓸 생각이던 댓글이 익명으로 나가는 사고를 되돌릴 수 없다.
 */
export function CommentComposer({
  viewer,
  identities,
  identity,
  onIdentityChange,
  onSubmit,
  onCancel,
  initialValue = "",
  placeholder = "댓글을 입력하세요…",
  submitLabel = "댓글 게시",
  focusOnMount = false,
  pending = false,
  error,
  inputRef,
  className = "border-t p-3",
}: {
  viewer: CommentViewer;
  identities: PostIdentity[];
  identity: PostIdentity;
  /** 선택지가 하나뿐이면 토글이 없으므로 불리지 않는다. */
  onIdentityChange?: (next: PostIdentity) => void;
  onSubmit: (body: string) => void | Promise<unknown>;
  /** 주면 되돌리기 버튼이 붙는다. 수정처럼 도중에 그만둘 수 있어야 하는 곳에서 쓴다. */
  onCancel?: () => void;
  /** 수정처럼 기존 본문에서 시작하는 경우. 마운트할 때 한 번만 반영된다. */
  initialValue?: string;
  placeholder?: string;
  submitLabel?: string;
  /** 답글 입력창처럼 사용자가 직접 연 입력기는 열자마자 포커스를 받는다. */
  focusOnMount?: boolean;
  pending?: boolean;
  error?: string | null;
  /** 바깥에서 포커스를 주려면 넘긴다(상세의 댓글 아이콘). 안 넘기면 내부 ref를 쓴다. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
  className?: string;
}) {
  const [draft, setDraft] = useState(initialValue);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<PostIdentity | null>(
    null,
  );
  // 한글 조합 중의 `Enter`는 글자를 확정하는 키다. 이걸 등록으로 처리하면 "안녕하세"까지만
  // 쓴 댓글이 올라간다.
  const composing = useRef(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? fallbackRef;

  useEffect(() => {
    // `autoFocus` 속성 대신 직접 부른다. 스크롤 영역 안에서 마운트되는 입력기라 브라우저가
    // 자동으로 스크롤을 옮기면 읽고 있던 자리를 잃는다.
    if (focusOnMount) input.current?.focus({ preventScroll: true });
  }, [focusOnMount, input]);

  // 높이 조절은 render가 끝난 뒤에 한다. 입력 핸들러 안에서 직접 스타일을 건드리면 등록 직후
  // 비워진 값과 아직 남아 있는 높이가 한 프레임 어긋난다.
  useEffect(() => {
    const element = input.current;
    if (element) resize(element);
  }, [draft, input]);

  const length = countCommentGraphemes(draft);
  const overLimit = length > COMMENT_MAX_LENGTH;
  const canSend = draft.trim() !== "" && !overLimit && !pending;
  const nextIdentity =
    identities[(identities.indexOf(identity) + 1) % identities.length];

  const send = () => {
    if (pending) return;
    const reason = validateCommentBody(draft);
    if (reason) return setLocalError(reason);
    setLocalError(null);
    const body = normalizeCommentBody(draft);
    setDraft("");
    void onSubmit(body);
  };

  const shown = localError ?? error;

  return (
    <>
      <div className={cn("flex items-end gap-2", className)}>
        {identities.length > 1 ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label={`${IDENTITY_LABEL[identity]}으로 작성 중. 눌러서 ${IDENTITY_LABEL[nextIdentity]}으로`}
                  onClick={() => setPendingIdentity(nextIdentity)}
                  className="relative mb-0.5 shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                />
              }
            >
              <IdentityAvatar identity={identity} viewer={viewer} />
              <span className="absolute -right-0.5 -bottom-0.5 flex rounded-full border bg-background p-0.5 text-muted-foreground">
                <ArrowLeftRightIcon className="size-2.5" aria-hidden="true" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {IDENTITY_LABEL[identity]}으로 작성 중
            </TooltipContent>
          </Tooltip>
        ) : (
          <IdentityAvatar
            identity={identity}
            viewer={viewer}
            className="mb-0.5"
          />
        )}

        <textarea
          ref={input}
          rows={1}
          value={draft}
          aria-label="댓글 입력"
          placeholder={placeholder}
          className="min-h-9 min-w-0 flex-1 resize-none overflow-y-hidden rounded-3xl bg-muted px-4 py-2 text-sm leading-5 outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setDraft(event.target.value);
            if (localError) setLocalError(null);
          }}
          onCompositionStart={() => (composing.current = true)}
          onCompositionEnd={() => (composing.current = false)}
          onKeyDown={(event) => {
            if (event.key === "Escape" && onCancel) {
              event.preventDefault();
              onCancel();
              return;
            }
            if (event.key !== "Enter" || event.shiftKey) return;
            if (composing.current || event.nativeEvent.isComposing) return;
            event.preventDefault();
            send();
          }}
        />

        {onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="text-muted-foreground"
            aria-label="되돌리기"
            onClick={onCancel}
          >
            <XIcon className="size-5" />
          </Button>
        ) : null}

        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="text-primary"
          aria-label={submitLabel}
          disabled={!canSend}
          onClick={send}
        >
          {pending ? <Spinner /> : <SendIcon className="size-5" />}
        </Button>
      </div>

      {shown || length > COUNTER_THRESHOLD ? (
        <div className="flex items-center gap-2 px-3 pb-2 text-xs">
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
      ) : null}

      {pendingIdentity ? (
        <ConfirmDialog
          title={`${IDENTITY_LABEL[pendingIdentity]}으로 작성할까요?`}
          description={`${IDENTITY_CONFIRMATION[pendingIdentity]} 작성한 뒤에는 신원을 바꿀 수 없습니다.`}
          confirmLabel="바꾸기"
          onCancel={() => setPendingIdentity(null)}
          onConfirm={() => {
            onIdentityChange?.(pendingIdentity);
            setPendingIdentity(null);
          }}
        />
      ) : null}
    </>
  );
}

function IdentityAvatar({
  identity,
  viewer,
  className,
}: {
  identity: PostIdentity;
  viewer: CommentViewer;
  className?: string;
}) {
  if (identity === "anonymous")
    return <PostAnonymousAvatar className={className} />;
  if (identity === "staff") return <PostStaffAvatar className={className} />;
  return (
    <UserAvatar
      src={viewer.avatarUrl}
      name={viewer.name}
      className={className}
    />
  );
}
