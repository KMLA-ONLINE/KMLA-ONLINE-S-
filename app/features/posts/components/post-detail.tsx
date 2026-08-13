import { PinIcon, XIcon } from "lucide-react";
import { Link, useFetcher } from "react-router";

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
import type { GroupPostDetail } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { useModalClose } from "~/shared/hooks/use-modal-close";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";

/**
 * 모바일은 전체화면, 데스크톱은 가운데 정렬된 모달.
 *
 * 높이를 `h-[90svh]`로 고정한 것이 핵심이다. 내용에 맞춰 늘어나게 두면 짧은 게시물과 긴
 * 게시물 사이를 오갈 때 모달 크기가 매번 달라져서, 목록에서 하나씩 열어볼 때 창이 계속
 * 출렁인다. `svh`는 모바일 주소창이 접히며 높이가 변하는 것까지 막는다.
 */
const DETAIL_DIALOG_CLASS =
  "modal-sheet flex h-[90svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-2xl";

export function PostDetail({
  post,
  slug,
}: {
  post: GroupPostDetail;
  slug: string;
}) {
  const fetcher = useFetcher();
  const close = useModalClose(`/groups/${slug}`);

  const { images, files } = splitPostAttachments(post.attachments);
  const authorName = post.author_name || post.author_label;
  const postPath = `/groups/${slug}/posts/${post.post_id}`;

  const submitIntent = (fields: Record<string, string>) =>
    void fetcher.submit(fields, { method: "post" });

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent showCloseButton={false} className={DETAIL_DIALOG_CLASS}>
        <DialogHeader className="relative flex-row items-center justify-center border-b p-3">
          <DialogTitle className="text-base font-semibold">
            {authorName}님의 게시물
          </DialogTitle>
          <DialogDescription className="sr-only">
            게시물 상세와 댓글
          </DialogDescription>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="닫기"
            onClick={close}
            className="absolute inset-y-0 right-3 my-auto text-muted-foreground"
          >
            <XIcon />
          </Button>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <article>
            <div className="flex flex-col gap-3 p-4">
              {post.is_pinned ? (
                <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                  <PinIcon className="size-3.5 -rotate-45 fill-current" />
                  고정된 게시물
                </div>
              ) : null}

              <header className="flex items-center gap-3">
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
                    {post.author_identity !== "anonymous" &&
                    post.author_pub_id ? (
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
                  onPin={() =>
                    submitIntent({
                      intent: "pin",
                      pinned: String(!post.is_pinned),
                    })
                  }
                  onDelete={() => submitIntent({ intent: "delete" })}
                />
              </header>

              <div>
                <h2 className="mb-2 text-xl font-semibold">{post.title}</h2>
                <PostMarkdown>{post.body}</PostMarkdown>
              </div>

              {/* 카드와 달리 모달은 콘텐츠에 `p-4` 여백이 있으므로 그리드도 모서리를 둥글린다. */}
              <PostImageGrid
                images={images}
                className="overflow-hidden rounded-lg"
              />
              <PostFileList files={files} />
            </div>

            <GroupPostActionBar sharePath={postPath} shareTitle={post.title} />
          </article>

          {/* 댓글은 후속 기능이다. 자리를 비워두되 왜 비어 있는지는 밝힌다. */}
          <section className="border-t p-4">
            <div className="py-10 text-center text-muted-foreground">
              <p className="font-semibold text-foreground">
                아직 댓글이 없습니다
              </p>
              <p className="mt-1 text-sm">댓글 기능을 준비하고 있습니다.</p>
            </div>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
