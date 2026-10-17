import { CheckIcon, CropIcon, ImageIcon, TypeIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  STORY_PLACED_LINK_CLASS,
  StoryLinkPillContent,
  storyPlacedCaptionClass,
} from "~/features/stories/components/story-canvas";
import {
  StoryPlacedHandle,
  StoryPlacedHandleHelp,
  useStoryLayoutGestures,
} from "~/features/stories/components/story-layout-editor";
import { storyKeys } from "~/features/stories/data/cache";
import { createImageStory } from "~/features/stories/data/files";
import {
  createTextStory,
  isStoryLimitError,
} from "~/features/stories/data/mutations";
import {
  buildStoryLayout,
  defaultStoryPlacement,
  isStoryContentValid,
  normalizeStoryContent,
  normalizeStoryLink,
  STORY_BACKGROUND_KEYS,
  STORY_BACKGROUNDS,
  STORY_CONTENT_MAX_LENGTH,
  STORY_SCALE_MAX,
  STORY_SCALE_MIN,
  type StoryBackground,
  type StoryLayout,
  type StoryLayoutElement,
  type StoryPlacement,
} from "~/features/stories/model/story";
import { ImageCropper } from "~/shared/components/image-cropper";
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

/** 사진을 9:16으로 잘라 올릴 때 결과의 긴 변. 원본 정책(`screen`)과 같다. */
const CROP_OUTPUT_EDGE = 2048;

const ELEMENT_LABELS: Record<StoryLayoutElement, string> = {
  text: "글",
  link: "링크",
};

interface PreparedImage {
  /** 고른 사진을 줄인 것. 다시 자를 때는 늘 여기서 자른다. 자른 결과를 또 자르면 점점 좁아진다. */
  base: File;
  baseUrl: string;
  file: File;
  thumbnail: File;
  width: number;
  height: number;
  previewUrl: string;
}

function defaultPlacements(mode: Mode): Required<StoryLayout> {
  return {
    text: defaultStoryPlacement("text", { overlay: mode === "photo" }),
    link: defaultStoryPlacement("link", { overlay: mode === "photo" }),
  };
}

/**
 * 업로드할 원본과 레일 축소본을 만든다. 축소본은 이미 줄인 원본에서 만든다. 원래 파일(최대
 * 50메가픽셀)을 두 번 디코딩하면 iOS에서 메모리 상한에 먼저 닿는다.
 */
async function prepareStoryImage(source: File) {
  const file = await compressImage(source, "screen");
  const thumbnail = await compressImage(file, "card");
  const [width, height] = await getImageDimensions(file);

  return { file, thumbnail, width, height };
}

export function StoryComposer({
  onDone,
  onPendingChange,
}: {
  onDone: () => void | Promise<void>;
  /**
   * 올리는 동안 부모가 창을 닫지 못하게 막는 데 쓴다. 실패하면 `false`를 알리고, 성공하면 알리지
   * 않고 `onDone`을 부른다.
   */
  onPendingChange?: (pending: boolean) => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("photo");
  const [image, setImage] = useState<PreparedImage | null>(null);
  const [processing, setProcessing] = useState(false);
  const [content, setContent] = useState("");
  const [background, setBackground] = useState<StoryBackground>("blue");
  const [link, setLink] = useState("");
  const [placements, setPlacements] = useState(() => defaultPlacements(mode));
  const [selected, setSelected] = useState<StoryLayoutElement | null>(null);
  const [cropping, setCropping] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 두 주소의 수명이 다르다. 원본 주소는 사진을 바꿀 때까지, 자른 결과 주소는 다시 자를 때까지
  // 산다. `image` 하나에 묶어 정리하면 자르기를 반영할 때 아직 쓰는 원본 주소까지 해제되어 다시
  // 자르기 창이 빈 사진을 연다.
  const baseUrl = image?.baseUrl;
  const previewUrl = image?.previewUrl;

  useEffect(() => {
    if (!baseUrl) return;
    return () => URL.revokeObjectURL(baseUrl);
  }, [baseUrl]);

  useEffect(() => {
    if (!previewUrl || previewUrl === baseUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl, baseUrl]);

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
  const editable = {
    text: Boolean(normalizedContent),
    link: Boolean(normalizedLink),
  };
  // 고른 요소가 사라졌으면(글을 지웠거나 링크가 틀렸으면) 남은 것을 고른 것으로 본다.
  const activeElement =
    selected && editable[selected]
      ? selected
      : editable.text
        ? "text"
        : editable.link
          ? "link"
          : null;

  function placeElement(
    element: StoryLayoutElement,
    placement: StoryPlacement,
  ) {
    setPlacements((previous) => ({ ...previous, [element]: placement }));
  }

  const gestures = useStoryLayoutGestures({
    placements,
    selected: activeElement,
    disabled: pending,
    onSelect: setSelected,
    onChange: placeElement,
  });

  function changeMode(next: Mode) {
    if (next === mode) return;
    setMode(next);
    // 글의 기본 자리가 종류마다 다르다. 사진 위 글은 아래쪽, 글 스토리는 가운데다. 사용자가 옮기거나
    // 키운 글은 그대로 둔다. 종류를 잠깐 바꿔 봤다고 맞춰 둔 자리를 잃으면 안 된다.
    setPlacements((previous) => {
      const untouched = defaultPlacements(mode).text;
      const moved =
        previous.text.x !== untouched.x ||
        previous.text.y !== untouched.y ||
        previous.text.scale !== untouched.scale;

      return moved
        ? previous
        : { ...previous, text: defaultPlacements(next).text };
    });
  }

  async function pickImage(file: File | undefined) {
    if (!file) return;

    setProcessing(true);
    setError(null);

    try {
      const prepared = await prepareStoryImage(file);
      const baseUrl = URL.createObjectURL(prepared.file);

      setImage({
        ...prepared,
        base: prepared.file,
        baseUrl,
        previewUrl: baseUrl,
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

  /** 9:16으로 자른 결과로 올릴 사진을 바꾼다. 자르기 전 사진은 다시 자를 때 쓰려고 남긴다. */
  async function applyCrop(cropped: File) {
    if (!image) return;

    setCropping(false);
    setProcessing(true);
    setError(null);

    try {
      const prepared = await prepareStoryImage(cropped);

      // 원본은 그대로 넘긴다. 다시 자를 때도 처음 고른 사진에서 자른다.
      setImage({
        ...prepared,
        base: image.base,
        baseUrl: image.baseUrl,
        previewUrl: URL.createObjectURL(prepared.file),
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

    // 부모에게는 effect가 아니라 지금 알린다. "올리는 중"이 그려진 뒤 effect가 돌기 전에 Esc가
    // 들어오면 부모가 아직 올리기 전이라고 보고 창을 닫는다(#244).
    setPending(true);
    onPendingChange?.(true);
    setError(null);

    const layout = buildStoryLayout(placements, {
      hasText: Boolean(normalizedContent),
      hasLink: Boolean(normalizedLink),
    });

    try {
      if (mode === "photo" && image) {
        await createImageStory({
          file: image.file,
          thumbnail: image.thumbnail,
          width: image.width,
          height: image.height,
          content: normalizedContent,
          linkUrl: normalizedLink,
          layout,
        });
      } else {
        await createTextStory({
          content: normalizedContent,
          background,
          linkUrl: normalizedLink,
          layout,
        });
      }
    } catch (cause) {
      setError(
        isStoryLimitError(cause)
          ? "24시간 동안 스토리는 20개까지 올릴 수 있습니다."
          : "스토리를 올리지 못했습니다. 다시 시도해 주세요.",
      );
      setPending(false);
      onPendingChange?.(false);
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
      <div className="contents md:flex md:w-72 md:shrink-0 md:flex-col md:gap-3">
        {/* 캔버스가 곧 편집 화면이다. 글과 링크를 끌어 옮기고 두 손가락으로 크기를 바꾼다.
            휴대폰에서는 캔버스가 화면 대부분을 차지하므로 빈 곳에서는 대화상자를 세로로 스크롤할
            수 있게 두고(`touch-pan-y`), 스크롤을 막는 것은 손잡이(`touch-none`)뿐이다. */}
        <div
          {...gestures}
          className={cn(
            "@container relative mx-auto aspect-[9/16] w-full max-w-72 touch-pan-y overflow-hidden rounded-xl",
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
            <StoryPlacedHandle
              element="text"
              placement={placements.text}
              selected={activeElement === "text"}
              disabled={pending}
              className={storyPlacedCaptionClass(mode === "photo")}
              onSelect={setSelected}
              onChange={placeElement}
            >
              {normalizedContent}
            </StoryPlacedHandle>
          ) : null}

          {normalizedLink ? (
            <StoryPlacedHandle
              element="link"
              placement={placements.link}
              selected={activeElement === "link"}
              disabled={pending}
              className={STORY_PLACED_LINK_CLASS}
              onSelect={setSelected}
              onChange={placeElement}
            >
              <StoryLinkPillContent url={normalizedLink} />
            </StoryPlacedHandle>
          ) : null}
        </div>

        <StoryPlacedHandleHelp />

        {activeElement ? (
          <div className="mx-auto flex w-full max-w-72 flex-col gap-1.5">
            <label
              htmlFor="story-element-scale"
              className="flex items-center justify-between text-xs text-muted-foreground"
            >
              <span>{ELEMENT_LABELS[activeElement]} 크기</span>
              <span>끌어서 옮기기</span>
            </label>
            <input
              id="story-element-scale"
              type="range"
              min={STORY_SCALE_MIN}
              max={STORY_SCALE_MAX}
              step={0.05}
              value={placements[activeElement].scale}
              onChange={(event) =>
                placeElement(activeElement, {
                  ...placements[activeElement],
                  scale: Number(event.currentTarget.value),
                })
              }
              disabled={pending}
              aria-label={`${ELEMENT_LABELS[activeElement]} 크기`}
              className="h-1 w-full cursor-pointer accent-primary"
            />
          </div>
        ) : null}

        {mode === "photo" && image ? (
          <div className="flex justify-center gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={processing || pending}
              onClick={() => setCropping(true)}
            >
              <CropIcon data-icon="inline-start" />
              사진 맞추기
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={processing || pending}
              onClick={() => fileInputRef.current?.click()}
            >
              {processing ? "사진 처리 중" : "다른 사진"}
            </Button>
          </div>
        ) : null}

        {cropping && image ? (
          // 고른 사진의 줄인 원본에서 자른다. 레이아웃 좌표와 달리 자르기는 파일 자체에 남기므로
          // 뷰어와 레일 축소본이 따로 위치를 계산하지 않는다.
          <ImageCropper
            file={image.base}
            previewUrl={image.baseUrl}
            aspect={9 / 16}
            maxOutputEdge={CROP_OUTPUT_EDGE}
            title="사진 맞추기"
            onCancel={() => setCropping(false)}
            onComplete={(cropped) => void applyCrop(cropped)}
          />
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
              onClick={() => changeMode(value)}
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
