import {
  ArrowLeftRightIcon,
  ImagePlusIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";

import {
  PostAnonymousAvatar,
  PostStaffAvatar,
} from "~/features/posts/components/post-author-avatar";
import { MentionButton } from "~/features/posts/components/mention-button";
import {
  activeMentionPubIds,
  remainingMentions,
  useMentionDraft,
} from "~/features/posts/hooks/use-mention-draft";
import {
  countMentionTargets,
  fromMentionDisplay,
  mentionDisplayRanges,
  mentionDisplayText,
  sanitizeMentionDisplay,
  toMentionDisplay,
  validateMentionCount,
  type MentionDraftEntry,
  type PostMention,
} from "~/features/posts/model/mentions";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { UserAvatar } from "~/shared/components/user-avatar";
import { cn } from "~/shared/lib/utils";
import { IMAGE_INPUT_ACCEPT } from "~/shared/lib/image/compress";
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
  initialMentions,
  mentionGroupId,
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
    mentions?: MentionDraftEntry[],
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
  /** 수정할 댓글이 이미 부르고 있던 사람들. 본문 토큰의 번호표다. */
  initialMentions?: PostMention[];
  /**
   * 멘션할 수 있는 그룹. 개인 게시물의 댓글에는 멘션을 두지 않으므로(기능 명세 §8.14) 그때는
   * 넘기지 않고, 그러면 버튼 자체가 사라진다. 익명으로 쓰는 동안에도 감춘다.
   */
  mentionGroupId?: string | null;
  className?: string;
}) {
  const mentionDraft = useMentionDraft(initialMentions ?? []);
  // 입력창이 드는 값은 원문이 아니라 표시형(`@홍길동`)이다. 원문은 제출과 검사에만 쓴다.
  const [draft, setDraft] = useState(() =>
    toMentionDisplay(initialValue, mentionDraft.entries),
  );
  const [image, setImage] = useState<
    CommentImage | PreparedCommentImage | null
  >(initialImage ?? null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [processingImage, setProcessingImage] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [pendingIdentity, setPendingIdentity] = useState<PostIdentity | null>(
    null,
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  // 한글 조합 중의 `Enter`는 글자를 확정하는 키다. 이걸 등록으로 처리하면 "안녕하세"까지만
  // 쓴 댓글이 올라간다.
  const composing = useRef(false);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const input = inputRef ?? fallbackRef;
  const pendingCaret = useRef<number | null>(null);
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

  // React가 제어하는 값을 textarea에 반영한 직후 커서를 옮긴다. animation frame까지 미루면
  // 그 사이 입력한 글자의 중간으로 이전 커서가 돌아갈 수 있다.
  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null) return;
    pendingCaret.current = null;

    const element = input.current;
    if (!element) return;
    element.focus();
    element.setSelectionRange(caret, caret);
  }, [draft, input]);

  const body = useMemo(
    () => fromMentionDisplay(draft, mentionDraft.entries),
    [draft, mentionDraft.entries],
  );
  // 길이 상한은 저장되는 원문에 걸린다. 화면에 보이는 글자 수로 세면 토큰 길이만큼 넘겨
  // 보내고 서버에서 거절당한다.
  const length = countCommentGraphemes(body);

  /** 입력창의 값과 캐럿을 함께 바꾼다. React가 값을 다시 심으면 캐럿이 끝으로 튄다. */
  const replaceDraft = (next: string, caret: number) => {
    if (next === draft) {
      const element = input.current;
      element?.focus();
      element?.setSelectionRange(caret, caret);
      return;
    }
    pendingCaret.current = caret;
    setDraft(next);
  };

  /**
   * 짝 잃은 표시를 걷어낸 값으로 맞춘다. 조합 중에는 부르지 않는다 — 값과 캐럿을 건드리면
   * 한글 조합이 끊긴다.
   */
  const repairDraft = (element: HTMLTextAreaElement) => {
    const value = element.value;
    const next = sanitizeMentionDisplay(value, mentionDraft.entries);
    if (next === value) {
      setDraft(value);
      return;
    }

    const caret = element.selectionStart ?? value.length;
    replaceDraft(next, Math.max(0, caret - (value.length - next.length)));
  };

  /**
   * 멘션은 한 덩어리로 지워진다. 이름 가운데를 지워 반쪽만 남으면 화면에는 멀쩡한 글자처럼
   * 보이는데 멘션은 아닌 상태가 되고, 지운 글자를 다시 치면 조용히 되살아난다.
   */
  const deleteAtomically = (
    element: HTMLTextAreaElement,
    key: "Backspace" | "Delete",
  ) => {
    const { selectionStart, selectionEnd } = element;
    const collapsed = selectionStart === selectionEnd;
    const from =
      collapsed && key === "Backspace" ? selectionStart - 1 : selectionStart;
    const to =
      collapsed && key === "Delete" ? selectionStart + 1 : selectionEnd;

    const touched = mentionDisplayRanges(draft, mentionDraft.entries).filter(
      (range) => range.start < to && from < range.end,
    );
    if (touched.length === 0) return false;

    const start = Math.min(from, ...touched.map((range) => range.start));
    const end = Math.max(to, ...touched.map((range) => range.end));
    replaceDraft(draft.slice(0, start) + draft.slice(end), start);
    return true;
  };
  const overLimit = length > COMMENT_MAX_LENGTH;
  const canSend =
    (draft.trim() !== "" || image !== null) &&
    !overLimit &&
    !pending &&
    !processingImage;
  const nextIdentity =
    identities[(identities.indexOf(identity) + 1) % identities.length];
  // 운영진 명의를 쓸 수 있으면 선택할 수 있는 신원을 한 화면에 모두 나열해 고르게 하고,
  // 그렇지 않으면 바꾸기 직전에 확인을 받는다(기능 명세 §9.1).
  const usesIdentityPicker = identities.includes("staff");
  const mentionBlocksAnonymous =
    countMentionTargets(body, mentionDraft.entries) > 0;

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
    const reason =
      validateCommentBody(body, image !== null) ??
      validateMentionCount(body, mentionDraft.entries);
    if (reason) return setLocalError(reason);
    setLocalError(null);
    const submittedBody = normalizeCommentBody(body);
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
      onSubmit(submittedBody, submittedImage, mentionDraft.entries),
    ).then((created) => {
      // 되돌리는 건 그 사이 아무것도 쓰지 않았을 때뿐이다. 새로 쓰고 있는 글을 덮으면 안 된다.
      if (!created)
        setDraft((current) => (current === "" ? submitted : current));
      else {
        mentionDraft.reset([]);
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
                  aria-label={
                    usesIdentityPicker
                      ? `${IDENTITY_LABEL[identity]}으로 작성 중. 눌러서 신원 선택`
                      : `${IDENTITY_LABEL[identity]}으로 작성 중. 눌러서 ${IDENTITY_LABEL[nextIdentity]}으로`
                  }
                  onClick={() => {
                    if (usesIdentityPicker) {
                      setPickerOpen(true);
                      return;
                    }
                    if (
                      nextIdentity === "anonymous" &&
                      mentionBlocksAnonymous
                    ) {
                      setLocalError(
                        "멘션을 모두 지운 뒤 익명으로 전환할 수 있습니다.",
                      );
                      return;
                    }
                    setPendingIdentity(nextIdentity);
                  }}
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
                  crossOrigin="anonymous"
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
                // 이름이 깨진 자리의 보이지 않는 표시를 걷어낸다. 남겨 두면 원래 이름을 다시
                // 쳤을 때 멘션이 되살아난다. 조합 중에는 미뤘다가 조합이 끝나면 정리한다.
                if (composing.current) setDraft(event.target.value);
                else repairDraft(event.target);
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
              onCompositionEnd={(event) => {
                composing.current = false;
                repairDraft(event.currentTarget);
              }}
              onKeyDown={(event) => {
                if (
                  (event.key === "Backspace" || event.key === "Delete") &&
                  !composing.current &&
                  !event.nativeEvent.isComposing
                ) {
                  if (deleteAtomically(event.currentTarget, event.key))
                    event.preventDefault();
                  return;
                }
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
              accept={IMAGE_INPUT_ACCEPT}
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
            {/*
              익명 댓글은 멘션할 수 없다(기능 명세 §8.14). 멘션 토큰이 남아 있으면 익명으로
              바꿀 수 없으므로 버튼이 사라질 때 활성 멘션이 함께 숨는 일은 없다.
            */}
            {mentionGroupId && identity !== "anonymous" ? (
              <MentionButton
                groupId={mentionGroupId}
                disabled={pending || processingImage}
                remaining={remainingMentions(body, mentionDraft.entries)}
                activeTargetPubIds={activeMentionPubIds(
                  body,
                  mentionDraft.entries,
                )}
                className="m-0.5 shrink-0 text-muted-foreground"
                onSelect={(candidate) => {
                  // 번호는 원문의 토큰을 보고 고른다. 표시형에는 토큰이 없어 언제나 1이
                  // 나오고, 두 번째로 고른 사람이 첫 번째를 덮는다.
                  const ordinal = mentionDraft.register(candidate, body);
                  if (ordinal === null) return;
                  const element = input.current;
                  // 이름이 같은 사람이 여럿이면 표시가 누구인지를 들고 다닌다. 어느
                  // 표시인지는 ordinal이 정하므로 초안의 다른 항목을 보지 않는다.
                  const label = `${mentionDisplayText(candidate.name, ordinal)} `;
                  const start = element?.selectionStart ?? draft.length;
                  const end = element?.selectionEnd ?? start;
                  replaceDraft(
                    draft.slice(0, start) + label + draft.slice(end),
                    start + label.length,
                  );
                }}
              />
            ) : null}
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

      {pickerOpen ? (
        <IdentityPickerDialog
          identities={identities}
          identity={identity}
          viewer={viewer}
          anonymousBlocked={mentionBlocksAnonymous}
          onCancel={() => setPickerOpen(false)}
          onConfirm={(next) => {
            setPickerOpen(false);
            if (next !== identity) onIdentityChange?.(next);
          }}
        />
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

/**
 * 댓글 작성 신원 선택 모달.
 *
 * 선택은 `바꾸기`를 누르기 전까지 이 모달 안에만 머문다. 입력창의 본문과 이미지 초안은
 * 건드리지 않으므로, 신원만 고르고 쓰던 댓글을 이어 갈 수 있다.
 */
function IdentityPickerDialog({
  identities,
  identity,
  viewer,
  anonymousBlocked,
  onCancel,
  onConfirm,
}: {
  identities: PostIdentity[];
  /** 현재 신원. 기본 선택이 된다. */
  identity: PostIdentity;
  viewer: CommentViewer;
  /** 활성 멘션이 남아 있으면 익명을 고를 수 없다(기능 명세 §8.14). */
  anonymousBlocked: boolean;
  onCancel: () => void;
  onConfirm: (next: PostIdentity) => void;
}) {
  const [selected, setSelected] = useState(identity);

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-w-xs" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>어떤 신원으로 작성할까요?</DialogTitle>
          <DialogDescription>
            작성한 뒤에는 댓글의 신원을 바꿀 수 없습니다.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="flex flex-col gap-1">
          <legend className="sr-only">댓글 작성 신원</legend>
          {identities.map((option) => {
            const disabled = option === "anonymous" && anonymousBlocked;
            return (
              <label
                key={option}
                className={cn(
                  "flex items-start gap-3 rounded-lg border p-3 text-left",
                  disabled
                    ? "opacity-60"
                    : "cursor-pointer hover:bg-accent has-checked:border-primary",
                )}
              >
                <input
                  type="radio"
                  name="comment-identity"
                  value={option}
                  checked={selected === option}
                  disabled={disabled}
                  onChange={() => setSelected(option)}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <IdentityAvatar identity={option} viewer={viewer} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {IDENTITY_LABEL[option]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {disabled
                      ? "멘션을 모두 지운 뒤 익명으로 전환할 수 있습니다."
                      : IDENTITY_CONFIRMATION[option]}
                  </span>
                </span>
              </label>
            );
          })}
        </fieldset>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onCancel}>
            취소
          </Button>
          <Button type="button" onClick={() => onConfirm(selected)}>
            바꾸기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
