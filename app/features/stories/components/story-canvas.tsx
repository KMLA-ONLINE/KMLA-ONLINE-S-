import { LinkIcon } from "lucide-react";
import type { CSSProperties } from "react";

import {
  getStoryLinkLabel,
  type StoryPlacement,
} from "~/features/stories/model/story";
import { ContentLink } from "~/shared/components/content-link";
import { cn } from "~/shared/lib/utils";

/*
 * 스토리 한 장 위에 얹는 글과 링크. 작성 창의 미리보기와 화면 전체 뷰어가 같은 모양이어야
 * 하므로 크기를 전부 컨테이너 폭(`cqw`) 비율로 잡는다. 부모 프레임에 `@container`를 걸어야
 * 한다. 값은 폭 390px 휴대폰에서 예전 뷰어 크기(글 스토리 24px, 사진 위 글 18px)가 되도록
 * 환산한 것이다.
 *
 * 자리(`StoryPlacement`)가 있으면 그 중심에 놓고 배율만큼 키운다. 없으면 위치 편집 전에 올린
 * 스토리라 예전 고정 자리에 그린다.
 */

/**
 * 놓인 자리의 위치와 크기. 배율은 `transform`으로 곱한다. 글자 크기를 바꾸면 줄바꿈 폭도 함께
 * 바뀌어 작성 창과 뷰어의 줄바꿈이 어긋날 수 있기 때문이다. 대신 최대 폭을 배율로 나눠 커진
 * 뒤의 폭이 캔버스의 90%를 넘지 않게 한다.
 */
export function storyPlacementStyle(placement: StoryPlacement): CSSProperties {
  return {
    left: `${placement.x * 100}%`,
    top: `${placement.y * 100}%`,
    transform: `translate(-50%, -50%) scale(${placement.scale})`,
    maxWidth: `calc(90cqw / ${placement.scale})`,
  };
}

/** 놓인 글의 모양. 사진 위 글은 어디에 놓여도 읽히도록 반투명한 바탕을 깐다. */
export function storyPlacedCaptionClass(overlay: boolean): string {
  return cn(
    "absolute w-max text-center [overflow-wrap:anywhere] break-keep whitespace-pre-wrap text-white",
    overlay
      ? "rounded-[2cqw] bg-black/45 px-[3cqw] py-[1.5cqw] text-[4.6cqw] leading-[7cqw] font-semibold"
      : "text-[6.2cqw] leading-[9cqw] font-bold [text-shadow:0_1px_4px_rgb(0_0_0/0.25)]",
  );
}

export function StoryCaption({
  text,
  overlay,
  hasLink,
  placement,
}: {
  text: string;
  /** 사진 위에 얹는 글이면 아래쪽 띠에, 글 스토리면 가운데에 크게 놓는다. */
  overlay: boolean;
  /** 링크 버튼이 있으면 사진 위 글을 그 위로 올린다. */
  hasLink: boolean;
  placement?: StoryPlacement;
}) {
  if (placement) {
    return (
      <p
        className={cn(storyPlacedCaptionClass(overlay), "pointer-events-none")}
        style={storyPlacementStyle(placement)}
      >
        {text}
      </p>
    );
  }

  if (overlay) {
    return (
      <p
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-[4cqw] pt-[10cqw] text-center text-[4.6cqw] leading-[7cqw] font-semibold [overflow-wrap:anywhere] whitespace-pre-wrap text-white",
          hasLink ? "pb-[20cqw]" : "pb-[8cqw]",
        )}
      >
        {text}
      </p>
    );
  }

  return (
    <p className="pointer-events-none absolute inset-0 flex items-center justify-center p-[6cqw] text-center text-[6.2cqw] leading-[9cqw] font-bold [overflow-wrap:anywhere] break-keep whitespace-pre-wrap text-white">
      {text}
    </p>
  );
}

const LINK_PILL_SHAPE =
  "flex items-center gap-[2cqw] rounded-full bg-white px-[4cqw] py-[2cqw] text-[3.6cqw] font-semibold text-black shadow-lg";

const LINK_PILL_DEFAULT_SPOT =
  "bottom-[max(6cqw,env(safe-area-inset-bottom))] left-1/2 max-w-[80%] -translate-x-1/2";

export const STORY_PLACED_LINK_CLASS = cn("absolute w-max", LINK_PILL_SHAPE);

export function StoryLinkPillContent({ url }: { url: string }) {
  return (
    <>
      <LinkIcon className="size-[4cqw] shrink-0" aria-hidden />
      <span className="truncate">{getStoryLinkLabel(url)}</span>
    </>
  );
}

/** 뷰어에서는 링크를 여는 버튼이고, 미리보기에서는 같은 모양의 표시일 뿐이다. */
export function StoryLinkPill({
  url,
  interactive,
  placement,
}: {
  url: string;
  interactive: boolean;
  placement?: StoryPlacement;
}) {
  const className = placement
    ? STORY_PLACED_LINK_CLASS
    : cn("absolute", LINK_PILL_SHAPE, LINK_PILL_DEFAULT_SPOT);
  const style = placement ? storyPlacementStyle(placement) : undefined;

  if (!interactive) {
    return (
      <span className={cn(className, "pointer-events-none")} style={style}>
        <StoryLinkPillContent url={url} />
      </span>
    );
  }

  return (
    <ContentLink
      href={url}
      className={cn(
        className,
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      style={style}
    >
      <StoryLinkPillContent url={url} />
    </ContentLink>
  );
}
