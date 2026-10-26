import {
  ChevronRightIcon,
  HeartIcon,
  MessageSquareIcon,
  PinIcon,
} from "lucide-react";
import { useEffect } from "react";
import { Link, useFetcher } from "react-router";
import { toast } from "sonner";

import { canHideProfileActivity } from "~/features/feed/model/hidden-profile-activities";
import type { FeedPost, GroupFeedPost } from "~/features/feed/model/types";
import { PostActionBar } from "~/features/posts/components/post-action-bar";
import { PostMenu } from "~/features/posts/components/post-menu";
import {
  PostFileList,
  PostImageGrid,
} from "~/features/posts/components/post-attachments";
import { splitPostAttachments } from "~/features/posts/model/attachments";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostBodyClamp } from "~/features/posts/components/post-body-clamp";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { ProfileMediaActivity } from "~/features/posts/components/profile/profile-media-activity";
import { StaffMark } from "~/features/posts/components/staff-mark";
import { ReactionEmoji } from "~/features/posts/components/reaction/reaction-emoji";
import { MediaPendingContext } from "~/features/posts/hooks/use-media-pending";
import { usePostEngagement } from "~/features/posts/hooks/use-post-engagement";
import { extractPostPlainText } from "~/features/posts/model/markdown";
import { useT, type Translate } from "~/shared/i18n";
import {
  feedDeleteFields,
  FROM_FEED,
  groupPostPath,
} from "~/features/posts/model/navigation";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

function feedPostPath(post: FeedPost): string {
  return post.kind === "group"
    ? groupPostPath(post.group_slug, post.post_id)
    : `/profile/${post.timeline_pub_id}/posts/${post.post_id}`;
}

function feedPostOverlayPath(post: FeedPost, comments = false): string {
  const searchParams = new URLSearchParams({
    post: post.post_id,
    kind: post.kind,
    source: post.kind === "group" ? post.group_slug : post.timeline_pub_id,
  });
  if (comments) searchParams.set("view", "comments");
  return `/?${searchParams.toString()}`;
}

function AuthorAvatar({ post }: { post: FeedPost }) {
  const t = useT();
  const name = post.author_name ?? post.author_label;
  const avatar = (
    <PostAuthorAvatar
      identity={post.author_identity}
      name={post.author_name}
      avatarUrl={post.author_avatar_url}
      size="default"
      className="size-9"
    />
  );

  if (post.author_identity === "anonymous" || !post.author_pub_id) {
    return avatar;
  }

  return (
    <Link
      to={`/profile/${post.author_pub_id}`}
      aria-label={t("{name} 프로필", { name })}
    >
      {avatar}
    </Link>
  );
}

function AuthorName({
  post,
  compact = false,
  preserveName = false,
}: {
  post: FeedPost;
  compact?: boolean;
  preserveName?: boolean;
}) {
  const name = post.author_name ?? post.author_label;
  // 활동 문구보다 이름을 먼저 지키되, 아주 긴 이름은 헤더를 넘지 않게 자른다.
  const className = cn(
    "truncate font-semibold",
    preserveName && "max-w-[60%] shrink-0",
    !compact && "text-sm",
  );

  if (post.author_identity === "anonymous" || !post.author_pub_id) {
    return <span className={className}>{name}</span>;
  }

  return (
    <Link
      to={`/profile/${post.author_pub_id}`}
      className={cn(className, "hover:underline")}
    >
      {name}
    </Link>
  );
}

/**
 * 내 글에만 다는 ⋯ 메뉴. 피드 RPC는 `can_*` 권한을 돌려주지 않는다 — 글마다 그룹 역할을
 * 따지면 피드 쿼리가 무거워지므로, 이미 있는 `is_author`로 작성자 몫(수정·삭제)만 연다.
 * 운영진의 삭제·고정과 신고는 상세의 메뉴에서 한다. 작성자의 권한은 그룹·개인 모두 `is_author`와
 * 같고, 프로필 사진·커버 활동 게시물만 수정할 수 없다(`get_*_post`의 `can_edit`).
 * 남의 프로필 변경 활동에는 이 기기에서만 접는 "가리기"만 연다.
 */
function FeedPostMenu({
  post,
  onHide,
}: {
  post: FeedPost;
  onHide?: () => void;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const path = feedPostPath(post);
  const result = fetcher.state === "idle" ? fetcher.data : undefined;

  // 같은 오류가 다시 나도 알리도록 문자열이 아니라 응답 객체를 본다.
  useEffect(() => {
    if (result?.error) toast.error(result.error);
  }, [result]);

  if (!post.is_author) {
    return onHide ? (
      <PostMenu
        editTo={`${path}/edit`}
        canEdit={false}
        canDelete={false}
        onHide={onHide}
      />
    ) : null;
  }

  return (
    <PostMenu
      editTo={`${path}/edit`}
      editState={FROM_FEED}
      canEdit={!(post.kind === "profile" && post.activity_kind)}
      canDelete
      onDelete={() =>
        void fetcher.submit(
          { intent: "delete", ...feedDeleteFields("card") },
          { method: "post", action: path },
        )
      }
    />
  );
}

function profileActivityText(post: FeedPost, t: Translate): string | null {
  if (post.kind !== "profile" || !post.activity_kind) return null;
  return t(
    post.activity_kind === "avatar_changed"
      ? "프로필 사진을 바꾸었습니다."
      : "프로필 커버를 바꾸었습니다.",
  );
}

/** 헤더에서 이름 뒤에 붙는 꼴. 영어는 이름 뒤에 오는 소문자 서술이라 독립 문구와 따로 둔다. */
function profileActivityAfterName(post: FeedPost, t: Translate): string | null {
  if (post.kind !== "profile" || !post.activity_kind) return null;
  return t(
    post.activity_kind === "avatar_changed"
      ? "님이 프로필 사진을 바꾸었습니다."
      : "님이 프로필 커버를 바꾸었습니다.",
  );
}

function FeedPostHeader({
  post,
  onHide,
}: {
  post: FeedPost;
  onHide?: () => void;
}) {
  const t = useT();
  const ownTimeline =
    post.kind === "profile" && post.author_pub_id === post.timeline_pub_id;
  const activityLabel = profileActivityAfterName(post, t);

  return (
    <header
      className={cn(
        "flex gap-2 px-4 pb-3",
        post.kind === "group" ? "items-center" : "items-start",
        post.kind === "group" && post.is_pinned ? "pt-2" : "pt-3",
      )}
    >
      <AuthorAvatar post={post} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          {post.kind === "group" ? (
            <>
              <Link
                to={`/groups/${post.group_slug}`}
                className="truncate text-sm font-semibold hover:underline"
              >
                {post.group_name}
              </Link>
            </>
          ) : (
            <AuthorName post={post} preserveName={Boolean(activityLabel)} />
          )}
          {activityLabel ? (
            <span className="truncate text-sm text-muted-foreground">
              {activityLabel}
            </span>
          ) : post.kind === "profile" && !ownTimeline ? (
            <>
              <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground" />
              <Link
                to={`/profile/${post.timeline_pub_id}`}
                className="truncate text-sm font-semibold hover:underline"
              >
                {post.timeline_name}
              </Link>
            </>
          ) : null}
          {!activityLabel &&
          post.kind === "profile" &&
          post.is_author &&
          post.author_identity === "anonymous" ? (
            <Badge variant="secondary" className="shrink-0">
              {t("나")}
            </Badge>
          ) : null}
        </div>
        <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
          {post.kind === "group" ? (
            <>
              <AuthorName post={post} compact />
              {post.author_identity === "staff" ? (
                <StaffMark className="size-3.5" />
              ) : null}
              {post.is_author && post.author_identity === "anonymous" ? (
                <Badge variant="secondary" className="shrink-0">
                  {t("나")}
                </Badge>
              ) : null}
              <span aria-hidden="true">·</span>
            </>
          ) : null}
          <RelativeTime value={post.published_at} />
        </div>
      </div>
      <FeedPostMenu post={post} onHide={onHide} />
    </header>
  );
}

export function FeedPostCard({
  post,
  mediaPending = false,
  onHide,
}: {
  post: FeedPost;
  mediaPending?: boolean;
  onHide?: () => void;
}) {
  const t = useT();
  const path = feedPostPath(post);
  const overlayPath = feedPostOverlayPath(post);
  const { images, files } = splitPostAttachments(post.attachments);
  const isMediaActivity = post.kind === "profile" && post.activity_kind;
  return (
    // 홈 피드는 서명을 뒤에서 채운다. 서명 중인 카드의 빈 미디어는 실패가 아니라 로딩으로 그린다.
    <MediaPendingContext value={mediaPending}>
      <article
        data-feed-post-id={post.post_id}
        className="overflow-hidden border-b-2 border-foreground/20 bg-card shadow-none md:rounded-xl md:border md:border-border md:shadow-sm"
      >
        {post.kind === "group" && post.is_pinned ? (
          <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-muted-foreground">
            <PinIcon className="size-3.5 -rotate-45 fill-current" />
            {t("고정된 게시물")}
          </div>
        ) : null}
        <FeedPostHeader
          post={post}
          onHide={canHideProfileActivity(post) ? onHide : undefined}
        />
        {isMediaActivity ? (
          <ProfileMediaActivity post={post} />
        ) : (
          <>
            <div className="px-4">
              {post.kind === "group" ? (
                <h2 className="mb-2 text-xl font-semibold">
                  <Link
                    to={overlayPath}
                    preventScrollReset
                    className="hover:underline"
                  >
                    {post.title}
                  </Link>
                </h2>
              ) : null}
              <PostBodyClamp postId={post.post_id} testId="feed-post-body">
                <PostMarkdown mentions={post.mentions}>
                  {post.body}
                </PostMarkdown>
              </PostBodyClamp>
            </div>
            <PostImageGrid images={images} className="mt-3" />
            {files.length > 0 ? (
              <div className="mt-3 px-4">
                <PostFileList files={files} />
              </div>
            ) : null}
          </>
        )}
        <PostActionBar
          postId={post.post_id}
          reaction={post}
          sharePath={path}
          shareTitle={
            post.kind === "group"
              ? post.title
              : t("{name}님의 게시물", {
                  name: post.author_name ?? t("사용자"),
                })
          }
          commentCount={post.comment_count}
          commentTo={feedPostOverlayPath(post, true)}
          className="mt-1"
        />
      </article>
    </MediaPendingContext>
  );
}

function groupListTitle(post: GroupFeedPost) {
  return post.title;
}

export function FeedPostRow({
  post,
  isVisited,
  onVisit,
  onHide,
}: {
  post: FeedPost;
  isVisited: boolean;
  onVisit: () => void;
  onHide?: () => void;
}) {
  const t = useT();
  const engagement = usePostEngagement(post.post_id, post);
  const path = feedPostOverlayPath(post);
  const author = post.author_name ?? post.author_label;
  const target = post.kind === "group" ? post.group_name : post.timeline_name;
  const text =
    post.kind === "group"
      ? groupListTitle(post)
      : (profileActivityText(post, t) ?? extractPostPlainText(post.body));
  const hide = canHideProfileActivity(post) ? onHide : undefined;

  return (
    <div
      data-testid="feed-post-row"
      className={cn(
        "flex items-start transition-colors hover:bg-muted/60",
        isVisited && "bg-muted/45",
      )}
    >
      <Link
        to={path}
        preventScrollReset
        onClick={onVisit}
        className="flex min-w-0 flex-1 flex-col gap-1 px-3 py-2.5 text-left"
      >
        <div className="flex items-center gap-2">
          {post.kind === "group" && post.is_pinned ? (
            <PinIcon
              className="size-4 shrink-0 -rotate-45 fill-current text-muted-foreground"
              aria-label={t("고정됨")}
            />
          ) : null}
          <p className="line-clamp-1 text-sm font-medium sm:text-base">
            {text}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="truncate">{author}</span>
          <ChevronRightIcon className="size-3 shrink-0" aria-hidden="true" />
          <span className="truncate">{target}</span>
          <span aria-hidden="true">·</span>
          <RelativeTime value={post.published_at} />
          <span className="ml-auto flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-1">
              {engagement.top_reactions.length ? (
                engagement.top_reactions.map((reaction) => (
                  <ReactionEmoji key={reaction} reaction={reaction} />
                ))
              ) : (
                <HeartIcon className="size-3.5" aria-hidden="true" />
              )}
              <span className="sr-only">{t("반응")}</span>
              {engagement.reaction_count}
            </span>
            <span className="flex items-center gap-1">
              <MessageSquareIcon className="size-3.5" aria-hidden="true" />
              <span className="sr-only">{t("댓글")}</span>
              {engagement.comment_count}
            </span>
          </span>
        </div>
      </Link>
      {hide ? (
        <div className="shrink-0 pt-2 pr-2">
          <FeedPostMenu post={post} onHide={hide} />
        </div>
      ) : null}
    </div>
  );
}
