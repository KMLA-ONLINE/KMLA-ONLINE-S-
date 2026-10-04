import { LinkIcon } from "lucide-react";

import { getStoryLinkLabel } from "~/features/stories/model/story";
import { cn } from "~/shared/lib/utils";

/**
 * 스토리 한 장 위에 얹는 글과 링크. 작성 창의 작은 미리보기와 화면 전체 뷰어가 같은 모양이어야
 * 하므로 크기를 전부 컨테이너 폭(`cqw`) 비율로 잡는다. 부모 프레임에 `@container`를 걸어야
 * 한다. 값은 폭 390px 휴대폰에서 예전 뷰어 크기(글 스토리 24px, 사진 위 글 18px)가 되도록
 * 환산한 것이다.
 */
export function StoryCaption({
  text,
  overlay,
  hasLink,
}: {
  text: string;
  /** 사진 위에 얹는 글이면 아래쪽 띠에, 글 스토리면 가운데에 크게 놓는다. */
  overlay: boolean;
  /** 링크 버튼이 있으면 사진 위 글을 그 위로 올린다. */
  hasLink: boolean;
}) {
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

const LINK_PILL_CLASS =
  "absolute bottom-[max(6cqw,env(safe-area-inset-bottom))] left-1/2 flex max-w-[80%] -translate-x-1/2 items-center gap-[2cqw] rounded-full bg-white px-[4cqw] py-[2cqw] text-[3.6cqw] font-semibold text-black shadow-lg";

/** 뷰어에서는 링크를 새 창으로 여는 버튼이고, 미리보기에서는 같은 모양의 표시일 뿐이다. */
export function StoryLinkPill({
  url,
  interactive,
}: {
  url: string;
  interactive: boolean;
}) {
  const content = (
    <>
      <LinkIcon className="size-[4cqw] shrink-0" aria-hidden />
      <span className="truncate">{getStoryLinkLabel(url)}</span>
    </>
  );

  if (!interactive) {
    return (
      <span className={cn(LINK_PILL_CLASS, "pointer-events-none")}>
        {content}
      </span>
    );
  }

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        LINK_PILL_CLASS,
        "outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      {content}
    </a>
  );
}
