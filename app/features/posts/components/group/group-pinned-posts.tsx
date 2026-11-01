import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { GroupPostHeader } from "~/features/posts/components/group/group-post-header";
import { GroupPostMenu } from "~/features/posts/components/group/group-post-menu";
import { GroupPostSection } from "~/features/posts/components/group/group-post-section";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import {
  attachmentMotionKind,
  splitPostAttachments,
} from "~/features/posts/model/attachments";
import { extractPostPreviewText } from "~/features/posts/model/markdown";
import { FROM_GROUP, groupPostPath } from "~/features/posts/model/navigation";
import type { GroupPost } from "~/features/posts/model/types";
import { Button } from "~/shared/ui/button";

/**
 * 끝에 닿은 넘김 버튼. `disabled`를 쓰면 키보드로 누르던 버튼이 끝에 닿는 순간 포커스를 잃어 위치를
 * 놓치므로 `aria-disabled`로 둔다. 끝에서 눌러도 더 스크롤할 곳이 없어 아무 일도 없다.
 */
const EDGE_BUTTON_CLASS =
  "text-muted-foreground aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent";

/**
 * 고정된 게시물. 게시물 탭 맨 위에 가로 카드로 놓는다. 목록 위에
 * 카드를 쌓지 않고 한 줄에 모아 목록 공간을 차지하지 않게 한다. 그룹에 들어오면 펼쳐 있다.
 * 카테고리 필터와 무관하며 아래 목록에도 원래 자리에 그대로 나온다.
 */
export function GroupPinnedPosts({
  slug,
  posts,
  failed = false,
  onRetry,
  collapsed,
  onCollapsedChange,
  onPin,
  onDelete,
}: {
  slug: string;
  posts: GroupPost[];
  /** 읽기에 실패해 보여 줄 글이 없을 때. 섹션이 조용히 사라지면 운영진은 고정이 풀린 줄 안다. */
  failed?: boolean;
  onRetry?: () => void;
  /** 접힘은 화면이 든다. 목록 패널은 탭을 오가면 다시 마운트되므로 거기 두면 접힘이 풀린다. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onPin: (post: GroupPost) => void;
  onDelete: (post: GroupPost) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(false);
  // 접으면 목록이 사라졌다가 펼칠 때 새로 붙으므로 ref 콜백에서 구독한다.
  const measureEdges = useCallback((list: HTMLUListElement) => {
    setAtStart(list.scrollLeft <= 1);
    setAtEnd(list.scrollLeft + list.clientWidth >= list.scrollWidth - 1);
  }, []);
  const attachList = useCallback(
    (list: HTMLUListElement) => {
      listRef.current = list;
      const measure = () => measureEdges(list);
      measure();
      list.addEventListener("scroll", measure, { passive: true });
      const observer =
        typeof ResizeObserver === "undefined"
          ? null
          : new ResizeObserver(measure);
      observer?.observe(list);
      return () => {
        list.removeEventListener("scroll", measure);
        observer?.disconnect();
        listRef.current = null;
      };
    },
    [measureEdges],
  );
  // 고정·해제는 목록 상자 크기를 바꾸지 않아 위 구독에 걸리지 않고 스크롤 길이만 바뀐다.
  useEffect(() => {
    if (listRef.current) measureEdges(listRef.current);
  }, [posts.length, measureEdges]);
  if (posts.length === 0) {
    if (!failed) return null;
    return (
      <p
        role="alert"
        className="flex items-center gap-2 border-b-2 border-foreground/20 bg-card px-4 py-3 text-sm text-muted-foreground md:rounded-xl md:border md:border-border md:shadow-sm"
      >
        고정된 게시물을 불러오지 못했습니다.
        {onRetry ? (
          <Button size="sm" variant="outline" onClick={onRetry}>
            다시 시도
          </Button>
        ) : null}
      </p>
    );
  }

  const scrollByCard = (direction: -1 | 1) => {
    const list = listRef.current;
    const card = list?.firstElementChild;
    if (!list || !(card instanceof HTMLElement)) return;
    // 간격은 목록의 `gap`에서 읽어 CSS와 두 번 적지 않는다. 애니메이션은 CSS `scroll-smooth`에
    // 맡긴다(동작 줄이기 설정이면 바로 건너뛴다).
    const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
    list.scrollBy({ left: direction * (card.offsetWidth + gap) });
  };

  return (
    <GroupPostSection
      title="고정된 게시물"
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      className="gap-2 border-b-2 border-foreground/20 bg-card py-3 md:rounded-xl md:border md:border-border md:px-4 md:shadow-sm"
      actions={
        posts.length > 1 ? (
          <div className="hidden items-center md:flex">
            <Button
              size="icon-sm"
              variant="ghost"
              className={EDGE_BUTTON_CLASS}
              aria-label="이전 고정 게시물"
              aria-disabled={atStart}
              onClick={() => scrollByCard(-1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className={EDGE_BUTTON_CLASS}
              aria-label="다음 고정 게시물"
              aria-disabled={atEnd}
              onClick={() => scrollByCard(1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        ) : null
      }
    >
      <ul
        ref={attachList}
        className="flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1 motion-safe:scroll-smooth md:scroll-px-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {posts.map((post) => (
          <li
            key={post.post_id}
            className="w-[78vw] max-w-72 shrink-0 snap-start md:w-72"
          >
            <GroupPinnedPostCard
              post={post}
              slug={slug}
              onPin={() => onPin(post)}
              onDelete={() => onDelete(post)}
            />
          </li>
        ))}
      </ul>
    </GroupPostSection>
  );
}

/**
 * 캐러셀 한 장. 전체 카드보다 작아 제목 두 줄·본문 세 줄·첫 사진만 보이고, 나머지는 상세에서 본다.
 * 본문은 서식 없는 글자다. 제목·문단 크기가 섞인 Markdown에 `line-clamp`를 걸면 줄이 어긋나 잘린다.
 */
function GroupPinnedPostCard({
  post,
  slug,
  onPin,
  onDelete,
}: {
  post: GroupPost;
  slug: string;
  onPin: () => void;
  onDelete: () => void;
}) {
  const postPath = groupPostPath(slug, post.post_id);
  const { images } = splitPostAttachments(post.attachments);
  // 카드 표지는 `<img>`다. 동영상과 GIF 본문은 그릴 수 없어 사진만 고른다.
  const cover = images.find((item) => !attachmentMotionKind(item));
  const coverUrl = cover ? (cover.thumbnailUrl ?? cover.signedUrl) : null;
  // 넘김 버튼 상태가 바뀔 때마다 카드가 다시 그려진다. 그때마다 Markdown을 파싱하지 않는다.
  const preview = useMemo(
    () => extractPostPreviewText(post.body, post.mentions),
    [post.body, post.mentions],
  );

  return (
    <article className="flex h-full flex-col overflow-hidden rounded-xl border border-border bg-background">
      <GroupPostHeader
        post={post}
        className="px-3 pt-3"
        menu={
          <GroupPostMenu
            post={post}
            slug={slug}
            onPin={onPin}
            onDelete={onDelete}
          />
        }
      />
      {/* 제목 링크 하나를 제목·본문·사진 전체로 넓힌다. 본문을 링크로 감싸면 낭독기가 본문까지 링크
          이름으로 읽고, 사진에 링크를 따로 두면 같은 곳으로 가는 탭 정지가 둘이 된다. */}
      <div className="relative flex flex-1 flex-col">
        <div className="px-3 pt-2">
          <h3 className="line-clamp-2 text-base font-semibold">
            <Link
              to={postPath}
              state={FROM_GROUP}
              className="outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-inset"
            >
              {post.title}
            </Link>
          </h3>
          {preview ? (
            <p className="mt-1 line-clamp-3 text-sm wrap-break-word whitespace-pre-line text-muted-foreground">
              {preview}
            </p>
          ) : null}
        </div>
        {coverUrl ? (
          // 글 길이가 달라도 나란한 카드의 사진이 같은 높이에 오도록 아래로 붙인다.
          <div className="mt-auto pt-2">
            <img
              src={coverUrl}
              alt=""
              className="aspect-video w-full object-cover"
              loading="lazy"
            />
          </div>
        ) : null}
      </div>
      <PostActionBar
        postId={post.post_id}
        reaction={{
          reaction_count: post.reaction_count,
          top_reactions: post.top_reactions,
          my_reaction: post.my_reaction,
        }}
        sharePath={postPath}
        shareTitle={post.title}
        commentCount={post.comment_count}
        commentTo={`${postPath}?view=comments`}
        commentState={FROM_GROUP}
        className="mt-1"
      />
    </article>
  );
}
