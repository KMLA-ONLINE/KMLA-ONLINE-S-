import { PinIcon } from "lucide-react";
import { useCallback, useState } from "react";
import { Link } from "react-router";

import { GroupPostActionBar } from "~/features/posts/components/group-post-action-bar";
import { GroupPostMenu } from "~/features/posts/components/group-post-menu";
import {
  PostFileList,
  PostImageGrid,
  splitPostAttachments,
} from "~/features/posts/components/post-attachments";
import { PostAuthorAvatar } from "~/features/posts/components/post-author-avatar";
import { PostEditedMark } from "~/features/posts/components/post-edited-mark";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import type { GroupPost } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";

/**
 * 접힌 본문의 최대 높이. `line-clamp`를 쓰지 않는 이유는 본문이 여러 블록(문단, 제목)으로
 * 이루어져 있어서다 — `-webkit-line-clamp`는 한 덩어리의 인라인 흐름만 자르므로 문단이
 * 두 개면 첫 문단만 잘리고 나머지는 그대로 나온다.
 */
const COLLAPSED_BODY_CLASS = "max-h-32 overflow-hidden";

export function GroupPostCard({
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
  const [expanded, setExpanded] = useState(false);
  const [clampable, setClampable] = useState(false);

  // 실제로 잘렸을 때만 "더 보기"를 그린다. 글자 수로 어림잡으면 폭이 넓은 화면에서 잘리지도
  // 않은 본문에 버튼이 붙는다.
  const measureBody = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    setClampable(node.scrollHeight > node.clientHeight);
  }, []);

  const postPath = `/groups/${slug}/posts/${post.post_id}`;
  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = post.author_name || post.author_label;

  return (
    <article className="overflow-hidden border-b-2 border-foreground/20 bg-card shadow-none md:rounded-xl md:border md:border-border md:shadow-sm">
      {post.is_pinned ? (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-muted-foreground">
          <PinIcon className="size-3.5 -rotate-45 fill-current" />
          고정된 게시물
        </div>
      ) : null}

      <header
        className={cn(
          "flex items-start gap-3 px-4 pb-3",
          post.is_pinned ? "pt-2" : "pt-4",
        )}
      >
        {post.author_identity !== "anonymous" && post.author_pub_id ? (
          <Link
            to={`/profile/${post.author_pub_id}`}
            aria-label={`${authorName} 프로필`}
          >
            <PostAuthorAvatar
              identity={post.author_identity}
              name={post.author_name}
              avatarPath={post.author_avatar_path}
              size="lg"
            />
          </Link>
        ) : (
          <PostAuthorAvatar
            identity={post.author_identity}
            name={post.author_name}
            avatarPath={post.author_avatar_path}
            size="lg"
          />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {post.author_identity !== "anonymous" && post.author_pub_id ? (
              <Link
                to={`/profile/${post.author_pub_id}`}
                className="truncate text-sm font-semibold hover:underline"
              >
                {authorName}
              </Link>
            ) : (
              <span className="truncate text-sm font-semibold">
                {authorName}
              </span>
            )}
            {post.author_identity === "staff" ? (
              <Badge
                variant="outline"
                className="shrink-0 text-muted-foreground"
              >
                운영진
              </Badge>
            ) : null}
            {post.is_author && post.author_identity !== "identified" ? (
              <Badge variant="secondary" className="shrink-0">
                나
              </Badge>
            ) : null}
            {post.category_name ? (
              <Badge variant="secondary" className="shrink-0">
                {post.category_name}
              </Badge>
            ) : null}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <RelativeTime value={post.published_at} />
            <PostEditedMark at={post.edited_at} />
          </div>
        </div>
        <GroupPostMenu
          editTo={`${postPath}/edit`}
          isPinned={post.is_pinned}
          canEdit={post.can_edit}
          canPin={post.can_pin}
          canDelete={post.can_delete}
          onPin={onPin}
          onDelete={onDelete}
        />
      </header>

      <div className="px-4">
        {/* 그룹 이름이 h1이므로 게시물 제목은 카드와 상세 모두 h2다. */}
        <h2 className="mb-2 text-xl font-semibold">
          <Link to={postPath} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        {/* 터치에서 본문을 탭해 펼치는 것은 포인터 전용 편의다. 키보드와 낭독기는 바로 아래
            "더 보기" 버튼을 쓰므로 여기에 role을 얹지 않는다. */}
        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
        <div
          ref={measureBody}
          onClick={() => {
            if (clampable || expanded) setExpanded((current) => !current);
          }}
          className={cn(
            !expanded && COLLAPSED_BODY_CLASS,
            // 터치 기기에서는 본문을 탭해도 펼쳐진다. 마우스에서는 버튼만 반응한다 —
            // 본문의 텍스트를 드래그해 선택하는 동작과 부딪히기 때문이다.
            (clampable || expanded) && "pointer-coarse:cursor-pointer",
          )}
        >
          <PostMarkdown>{post.body}</PostMarkdown>
        </div>
        {clampable || expanded ? (
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            className="mt-0.5 text-sm font-medium text-muted-foreground hover:underline pointer-fine:font-semibold pointer-fine:text-foreground"
          >
            {expanded ? "접기" : "더 보기"}
          </button>
        ) : null}
      </div>

      <PostImageGrid images={images} className="mt-3" />
      {files.length > 0 ? (
        <div className="mt-3 px-4">
          <PostFileList files={files} />
        </div>
      ) : null}

      <GroupPostActionBar
        sharePath={postPath}
        shareTitle={post.title}
        className="mt-1"
      />
    </article>
  );
}
