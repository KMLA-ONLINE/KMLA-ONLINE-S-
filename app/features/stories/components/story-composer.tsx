import { CheckIcon, ImageIcon, TypeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  StoryCaption,
  StoryLinkPill,
} from "~/features/stories/components/story-canvas";
import { storyKeys } from "~/features/stories/data/cache";
import { createImageStory } from "~/features/stories/data/files";
import {
  createTextStory,
  isStoryLimitError,
} from "~/features/stories/data/mutations";
import {
  isStoryContentValid,
  normalizeStoryContent,
  normalizeStoryLink,
  STORY_BACKGROUND_KEYS,
  STORY_BACKGROUNDS,
  STORY_CONTENT_MAX_LENGTH,
  type StoryBackground,
} from "~/features/stories/model/story";
import {
  compressImage,
  getImageDimensions,
  IMAGE_INPUT_ACCEPT,
} from "~/shared/lib/image/compress";
import { getQueryClient } from "~/shared/lib/query-client";
import { cn } from "~/shared/lib/utils";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Textarea } from "~/shared/ui/textarea";

type Mode = "photo" | "text";

const BACKGROUND_LABELS: Record<StoryBackground, string> = {
  blue: "파랑",
  purple: "보라",
  pink: "분홍",
  orange: "주황",
  green: "초록",
  dark: "검정",
};

interface PreparedImage {
  file: File;
  thumbnail: File;
  width: number;
  height: number;
  previewUrl: string;
}

export function StoryComposer({
  onDone,
  onPendingChange,
}: {
  onDone: () => void | Promise<void>;
  /** 올리는 동안 부모가 창을 닫지 못하게 막는 데 쓴다. */
  onPendingChange?: (pending: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("photo");
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [processing, setProcessing] = useState(false);
  const [content, setContent] = useState("");
  const [background, setBackground] = useState<StoryBackground>("blue");
  const [link, setLink] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    onPendingChange?.(pending);
  }, [pending, onPendingChange]);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () => () => {
      if (image) URL.revokeObjectURL(image.previewUrl);
    },
    [image],
  );

  const normalizedContent = normalizeStoryContent(content);
  const normalizedLink = normalizeStoryLink(link);
  const contentValid = isStoryContentValid(content, {
    required: mode === "text",
  });
  const ready =
    contentValid &&
    normalizedLink !== undefined &&
    (mode === "text" || image !== null) &&
    !processing;

  async function pickImage(file: File | undefined) {
    if (!file) return;

    setProcessing(true);
    setError(null);

    try {
      // 축소본은 이미 줄인 원본에서 만든다. 원래 파일(최대 50메가픽셀)을 두 번 디코딩하면 iOS에서
      // 메모리 상한에 먼저 닿는다.
      const compressed = await compressImage(file, "screen");
      const thumbnail = await compressImage(compressed, "card");
      const [width, height] = await getImageDimensions(compressed);

      setImage({
        file: compressed,
        thumbnail,
        width,
        height,
        previewUrl: URL.createObjectURL(compressed),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "이미지를 처리하지 못했습니다.",
      );
    } finally {
      setProcessing(false);
    }
  }

  async function submit() {
    if (!ready || pending || normalizedLink === undefined) return;

    setPending(true);
    setError(null);

    try {
      if (mode === "photo" && image) {
        await createImageStory({
          file: image.file,
          thumbnail: image.thumbnail,
          width: image.width,
          height: image.height,
          content: normalizedContent,
          linkUrl: normalizedLink,
        });
      } else {
        await createTextStory({
          content: normalizedContent,
          background,
          linkUrl: normalizedLink,
        });
      }
    } catch (cause) {
      setError(
        isStoryLimitError(cause)
          ? "24시간 동안 스토리는 20개까지 올릴 수 있습니다."
          : "올리지 못했습니다.",
      );
      setPending(false);
      return;
    }

    // 여기부터는 이미 올라간 뒤다. 목록 갱신이 실패해도 "올리지 못했습니다"로 보이면 사용자가
    // 다시 눌러 같은 스토리를 두 번 올린다.
    await getQueryClient()
      .invalidateQueries({ queryKey: storyKeys.all, refetchType: "none" })
      .catch(() => undefined);
    await Promise.resolve(onDone()).catch(() => undefined);
  }

  return (
    <form
      // 링크 칸은 모바일 키보드 때문에 `type="url"`이지만, 스킴 없는 주소도 받으므로 브라우저
      // 검증은 끈다. 판정은 `normalizeStoryLink`가 한다.
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      className="flex min-w-0 flex-col gap-5 md:flex-row md:items-start md:gap-6"
    >
      {/* 휴대폰에서는 두 묶음을 `contents`로 풀어 한 줄로 쌓고(종류 선택이 맨 위), 넓은 화면에서는
          미리보기를 왼쪽, 입력을 오른쪽에 둔다. 세로로 긴 미리보기 아래에 입력을 이어 붙이면
          데스크톱 창이 필요 이상으로 길어진다. */}
      <div className="contents md:flex md:w-60 md:shrink-0 md:flex-col md:gap-3">
        <div
          className={cn(
            "@container relative mx-auto aspect-[9/16] w-full max-w-60 overflow-hidden rounded-xl",
            mode === "text"
              ? STORY_BACKGROUNDS[background]
              : image
                ? "bg-black"
                : "bg-muted",
          )}
        >
          {mode === "photo" && image ? (
            <img
              src={image.previewUrl}
              alt=""
              className="absolute inset-0 size-full object-contain"
            />
          ) : null}

          {mode === "photo" && !image ? (
            <button
              type="button"
              disabled={processing || pending}
              onClick={() => fileInputRef.current?.click()}
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ImageIcon className="size-8" aria-hidden />
              {processing ? "사진 처리 중" : "사진 선택"}
            </button>
          ) : null}

          {normalizedContent ? (
            <StoryCaption
              text={normalizedContent}
              overlay={mode === "photo"}
              hasLink={Boolean(normalizedLink)}
            />
          ) : null}

          {normalizedLink ? (
            <StoryLinkPill url={normalizedLink} interactive={false} />
          ) : null}
        </div>

        {mode === "photo" && image ? (
          <Button
            type="button"
            variant="outline"
            className="self-center"
            disabled={processing || pending}
            onClick={() => fileInputRef.current?.click()}
          >
            {processing ? "사진 처리 중" : "다른 사진"}
          </Button>
        ) : null}
      </div>

      <div className="contents md:flex md:min-w-0 md:flex-1 md:flex-col md:gap-5">
        <div
          role="radiogroup"
          aria-label="스토리 종류"
          className="-order-1 grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 md:order-none"
        >
          {(
            [
              ["photo", "사진", ImageIcon],
              ["text", "글", TypeIcon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={mode === value}
              disabled={pending}
              onClick={() => setMode(value)}
              className={cn(
                "flex h-9 items-center justify-center gap-1.5 rounded-md text-sm font-medium text-muted-foreground transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                mode === value && "bg-background text-foreground shadow-sm",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </button>
          ))}
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_INPUT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void pickImage(event.currentTarget.files?.[0]);
            event.currentTarget.value = "";
          }}
        />

        {mode === "text" ? (
          <div
            role="radiogroup"
            aria-label="배경"
            className="flex justify-center gap-2"
          >
            {STORY_BACKGROUND_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={background === key}
                aria-label={BACKGROUND_LABELS[key]}
                disabled={pending}
                onClick={() => setBackground(key)}
                className={cn(
                  "flex size-8 items-center justify-center rounded-full text-white ring-offset-2 ring-offset-background outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  STORY_BACKGROUNDS[key],
                  background === key && "ring-2 ring-foreground",
                )}
              >
                {background === key ? (
                  <CheckIcon className="size-4" aria-hidden />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-end justify-between gap-4">
            <label htmlFor="story-content" className="text-sm font-medium">
              글
            </label>
            <span className="text-xs text-muted-foreground">
              {normalizedContent.length}/{STORY_CONTENT_MAX_LENGTH}
            </span>
          </div>
          <Textarea
            id="story-content"
            value={content}
            onChange={(event) => setContent(event.currentTarget.value)}
            maxLength={STORY_CONTENT_MAX_LENGTH}
            rows={3}
            placeholder="무슨 일이 있었나요?"
            disabled={pending}
            className="[field-sizing:fixed] min-h-20 max-w-full min-w-0 resize-none"
          />
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <label htmlFor="story-link" className="text-sm font-medium">
            링크 (선택)
          </label>
          <Input
            id="story-link"
            type="url"
            inputMode="url"
            value={link}
            onChange={(event) => setLink(event.currentTarget.value)}
            placeholder="https://"
            aria-invalid={normalizedLink === undefined}
            disabled={pending}
          />
          {normalizedLink === undefined ? (
            <p className="text-xs text-destructive">
              http 또는 https 주소를 입력하세요.
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="text-xs text-destructive">
            {error}
          </p>
        ) : null}

        <Button type="submit" disabled={!ready || pending}>
          {pending ? "올리는 중" : "공유"}
        </Button>
      </div>
    </form>
  );
}
