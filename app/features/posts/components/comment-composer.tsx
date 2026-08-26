import {
  ArrowLeftRightIcon,
  ImagePlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
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
import {
  prepareCommentImage,
  releasePostFile,
} from "~/features/posts/model/attachments";
import type {
  CommentImage,
  CommentImageInput,
  PostIdentity,
  PreparedCommentImage,
} from "~/features/posts/model/types";
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
 *
 * 다섯 줄까지 보이고 그 뒤로 스크롤한다 — 줄 높이 24px × 5 + 안쪽 여백 12px = 132px에
 * 여유를 둔 값이다. 여섯 줄(156px)에는 닿지 않아야 한다. 본문 글자 크기나 `py-1.5`를
 * 바꾸면 이 값도 같이 봐야 한다.
 */
const MAX_HEIGHT = 140;

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
 * 댓글 입력창. 하단 고정 댓글과 답글, 댓글 수정이 같은 컴포넌트를 쓴다. 답글 대상은 입력값에
 * 넣지 않고 입력창 위에 따로 표시해 저장되는 평문과 대화 관계를 섞지 않는다.
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
  replyTarget,
  onCancelReply,
  initialImage,
  className = "border-t p-3",
}: {
  viewer: CommentViewer;
  identities: PostIdentity[];
  identity: PostIdentity;
  /** 선택지가 하나뿐이면 토글이 없으므로 불리지 않는다. */
  onIdentityChange?: (next: PostIdentity) => void;
  /** 성공하면 정본 행을, 실패하면 falsy를 돌려준다. falsy면 입력값을 되돌린다. */
  onSubmit: (
    body: string,
    image?: CommentImageInput,
  ) => void | Promise<unknown>;
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
  /** 하단 입력기가 답글 모드일 때 표시할 대상 이름. 본문에는 포함하지 않는다. */
  replyTarget?: string;
  onCancelReply?: () => void;
  initialImage?: CommentImage;
  className?: string;
}) {
  const [draft, setDraft] = useState(initialValue);
  const [image, setImage] = useState<
    CommentImage | PreparedCommentImage | null
  >(initialImage ?? null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<PostIdentity | null>(
    null,
  );
  // 한글 조합 중의 `Enter`는 글자를 확정하는 키다. 이걸 등록으로 처리하면 "안녕하세"까지만
  // 쓴 댓글이 올라간다.
  const composing = useRef(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? fallbackRef;
  const fileInput = useRef<HTMLInputElement>(null);
  const preparedImage = useRef<PreparedCommentImage | null>(null);

  useEffect(
    () => () => {
      if (preparedImage.current) releasePostFile(preparedImage.current);
    },
    [],
  );

  useEffect(() => {
    // `autoFocus` 속성 대신 직접 부른다. 스크롤 영역 안에서 마운트되는 입력기라 브라우저가
    // 자동으로 스크롤을 옮기면 읽고 있던 자리를 잃는다.
    const element = input.current;
    if (!focusOnMount || !element) return;
    element.focus({ preventScroll: true });
    // 수정처럼 기존 본문을 담고 여는 입력창은 커서를 끝에 둔다. 그냥 포커스만 주면 맨 앞에
    // 서서, 이어 쓰려던 사람이 매번 커서를 옮겨야 한다.
    const end = element.value.length;
    element.setSelectionRange(end, end);
  }, [focusOnMount, input]);

  // 높이 조절은 render가 끝난 뒤에 한다. 입력 핸들러 안에서 직접 스타일을 건드리면 등록 직후
  // 비워진 값과 아직 남아 있는 높이가 한 프레임 어긋난다.
  useEffect(() => {
    const element = input.current;
    if (element) resize(element);
  }, [draft, input]);

  const length = countCommentGraphemes(draft);
  const overLimit = length > COMMENT_MAX_LENGTH;
  const canSend =
    (draft.trim() !== "" || image !== null) &&
    !overLimit &&
    !pending &&
    !processingImage;
  const nextIdentity =
    identities[(identities.indexOf(identity) + 1) % identities.length];

  const selectImage = async (file: File | undefined) => {
    if (!file || processingImage || pending) return;
    setProcessingImage(true);
    setLocalError(null);
    try {
      const prepared = await prepareCommentImage(file);
      if (preparedImage.current) releasePostFile(preparedImage.current);
      preparedImage.current = prepared;
      setImage(prepared);
      setImageRemoved(false);
    } catch (cause) {
      setLocalError(
        cause instanceof Error
          ? cause.message
          : "이미지를 처리하지 못했습니다.",
      );
    } finally {
      setProcessingImage(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  };

  const removeImage = () => {
    if (preparedImage.current) {
      releasePostFile(preparedImage.current);
      preparedImage.current = null;
    }
    setImage(null);
    setImageRemoved(Boolean(initialImage));
  };

  const send = () => {
    if (pending || processingImage) return;
    const reason = validateCommentBody(draft, image !== null);
    if (reason) return setLocalError(reason);
    setLocalError(null);
    const body = normalizeCommentBody(draft);
    // 입력창은 먼저 비운다(메신저처럼 즉시 반응해야 한다). 다만 등록이 실패하면 되돌린다 —
    // 오류 문구만 남기고 쓴 글을 버리면 긴 댓글을 처음부터 다시 쓰는 수밖에 없다.
    const submitted = draft;
    setDraft("");
    const submittedImage: CommentImageInput | undefined = imageRemoved
      ? null
      : image === initialImage || (image === null && !initialImage)
        ? undefined
        : image;
    void Promise.resolve(
      submittedImage === undefined
        ? onSubmit(body)
        : onSubmit(body, submittedImage),
    ).then((created) => {
      // 되돌리는 건 그 사이 아무것도 쓰지 않았을 때뿐이다. 새로 쓰고 있는 글을 덮으면 안 된다.
      if (!created)
        setDraft((current) => (current === "" ? submitted : current));
      else {
        if (preparedImage.current) releasePostFile(preparedImage.current);
        preparedImage.current = null;
        setImage(null);
        setImageRemoved(false);
      }
    });
  };

  const shown = localError ?? error;

  return (
    <>
      {replyTarget ? (
        <div className="flex items-center gap-2 border-t px-4 pt-2 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate">
            <strong className="font-semibold text-foreground">
              {replyTarget}
            </strong>
            님에게 답글
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            aria-label="답글 대상 취소"
            className="shrink-0"
            onClick={onCancelReply}
          >
            <XIcon />
          </Button>
        </div>
      ) : null}

      <div
        className={cn(
          "flex items-end gap-2",
          className,
          replyTarget && "border-t-0 pt-2",
        )}
      >
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

        <div
          className="min-w-0 flex-1 rounded-3xl bg-muted"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes("Files"))
              event.preventDefault();
          }}
          onDrop={(event) => {
            event.preventDefault();
            void selectImage(event.dataTransfer.files[0]);
          }}
        >
          {image ? (
            <div className="relative mx-3 mt-3 w-fit">
              {"file" in image || image.signedUrl ? (
                <img
                  src={
                    "file" in image
                      ? image.previewUrl
                      : (image.signedUrl ?? undefined)
                  }
                  alt="댓글 이미지 미리보기"
                  className="max-h-32 max-w-48 rounded-xl object-cover"
                />
              ) : (
                <span className="block px-3 py-8 text-xs text-muted-foreground">
                  이미지를 불러오지 못했습니다
                </span>
              )}
              <Button
                type="button"
                size="icon-xs"
                variant="secondary"
                aria-label="댓글 이미지 제거"
                className="absolute -top-2 -right-2 rounded-full shadow-sm"
                onClick={removeImage}
              >
                <XIcon />
              </Button>
            </div>
          ) : null}
          <div className="flex items-end">
            <textarea
              ref={input}
              rows={1}
              value={draft}
              aria-label="댓글 입력"
              placeholder={placeholder}
              className="min-h-9 min-w-0 flex-1 resize-none overflow-y-hidden bg-transparent px-4 py-1.5 text-base leading-6 outline-none placeholder:text-muted-foreground"
              onChange={(event) => {
                setDraft(event.target.value);
                if (localError) setLocalError(null);
              }}
              onPaste={(event) => {
                const pasted = Array.from(event.clipboardData.items).find(
                  (item) =>
                    item.kind === "file" && item.type.startsWith("image/"),
                );
                if (!pasted) return;
                event.preventDefault();
                void selectImage(pasted.getAsFile() ?? undefined);
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
            <input
              ref={fileInput}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="sr-only"
              aria-label="댓글 이미지 선택"
              onChange={(event) => void selectImage(event.target.files?.[0])}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="댓글 이미지 추가"
              disabled={pending || processingImage}
              className="m-0.5 shrink-0 text-muted-foreground"
              onClick={() => fileInput.current?.click()}
            >
              {processingImage ? <Spinner /> : <ImagePlusIcon />}
            </Button>
          </div>
        </div>

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
