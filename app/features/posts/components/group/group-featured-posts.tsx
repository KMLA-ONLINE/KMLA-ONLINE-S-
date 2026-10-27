import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";

import { GroupPostHeader } from "~/features/posts/components/group/group-post-header";
import { GroupPostMenu } from "~/features/posts/components/group/group-post-menu";
import { GroupPostSection } from "~/features/posts/components/group/group-post-section";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { splitPostAttachments } from "~/features/posts/model/attachments";
import { FROM_GROUP, groupPostPath } from "~/features/posts/model/navigation";
import type { GroupPost } from "~/features/posts/model/types";
import { Button } from "~/shared/ui/button";

/**
 * 대표 게시물. 페이스북 그룹의 "대표 콘텐츠"처럼 게시물 탭 맨 위에 가로 카드로 놓는다. 그룹에
 * 들어오면 접혀 있어 최근 글이 먼저 보이고, 펼치면 카드가 나온다.
 * 카테고리 필터와 무관하며 아래 목록에도 원래 자리에 그대로 나온다.
 */
export function GroupFeaturedPosts({
  slug,
  posts,
  failed = false,
  onRetry,
  collapsed,
  onCollapsedChange,
  onPin,
  onFeature,
  onDelete,
}: {
  slug: string;
  posts: GroupPost[];
  /** 읽기에 실패해 보여 줄 글이 없을 때. 섹션이 조용히 사라지면 운영진은 대표가 풀린 줄 안다. */
  failed?: boolean;
  onRetry?: () => void;
  /** 접힘은 화면이 든다. 목록 패널은 고정·삭제 뒤 다시 마운트되므로 거기 두면 펼친 채로 남지 않는다. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  onPin: (post: GroupPost) => void;
  onFeature: (post: GroupPost) => void;
  onDelete: (post: GroupPost) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  if (posts.length === 0) {
    if (!failed) return null;
    return (
      <p
        role="alert"
        className="flex items-center gap-2 border-b-2 border-foreground/20 bg-card px-4 py-3 text-sm text-muted-foreground md:rounded-xl md:border md:border-border md:shadow-sm"
      >
        대표 게시물을 불러오지 못했습니다.
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
      title="대표 게시물"
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      className="gap-2 border-b-2 border-foreground/20 bg-card py-3 md:rounded-xl md:border md:border-border md:px-4 md:shadow-sm"
      actions={
        posts.length > 1 ? (
          <div className="hidden items-center md:flex">
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label="이전 대표 게시물"
              onClick={() => scrollByCard(-1)}
            >
              <ChevronLeftIcon className="size-4" />
            </Button>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground"
              aria-label="다음 대표 게시물"
              onClick={() => scrollByCard(1)}
            >
              <ChevronRightIcon className="size-4" />
            </Button>
          </div>
        ) : null
      }
    >
      <ul
        ref={listRef}
        className="flex snap-x snap-mandatory scroll-px-4 [scrollbar-width:none] gap-3 overflow-x-auto px-4 pb-1 motion-safe:scroll-smooth md:scroll-px-0 md:px-0 [&::-webkit-scrollbar]:hidden"
      >
        {posts.map((post) => (
          <li
            key={post.post_id}
            className="w-[78vw] max-w-72 shrink-0 snap-start md:w-72"
          >
            <GroupFeaturedPostCard
              post={post}
              slug={slug}
              onPin={() => onPin(post)}
              onFeature={() => onFeature(post)}
              onDelete={() => onDelete(post)}
            />
          </li>
        ))}
      </ul>
    </GroupPostSection>
  );
}

/** 캐러셀 한 장. 전체 카드보다 작아 제목 두 줄·본문 세 줄·첫 사진만 보이고, 나머지는 상세에서 본다. */
function GroupFeaturedPostCard({
  post,
  slug,
  onPin,
  onFeature,
  onDelete,
}: {
  post: GroupPost;
  slug: string;
  onPin: () => void;
  onFeature: () => void;
  onDelete: () => void;
}) {
  const postPath = groupPostPath(slug, post.post_id);
  const { images } = splitPostAttachments(post.attachments);
  const cover = images[0];
  const coverUrl = cover ? (cover.thumbnailUrl ?? cover.signedUrl) : null;

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
            onFeature={onFeature}
            onDelete={onDelete}
          />
        }
      />
      <div className="px-3 pt-2">
        <h3 className="line-clamp-2 text-base font-semibold">
          <Link to={postPath} state={FROM_GROUP} className="hover:underline">
            {post.title}
          </Link>
        </h3>
        {post.body ? (
          <div className="mt-1 line-clamp-3 text-sm text-muted-foreground">
            <PostMarkdown mentions={post.mentions}>{post.body}</PostMarkdown>
          </div>
        ) : null}
      </div>
      {coverUrl ? (
        <Link
          to={postPath}
          state={FROM_GROUP}
          aria-label={`${post.title} 사진`}
          className="mt-2 block"
        >
          <img
            src={coverUrl}
            alt=""
            className="aspect-video w-full object-cover"
            loading="lazy"
          />
        </Link>
      ) : null}
      <div className="mt-auto">
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
      </div>
    </article>
  );
}
