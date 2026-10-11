import { PinIcon } from "lucide-react";
import { Link } from "react-router";

import { PostActionBar } from "~/features/posts/components/post-action-bar";
import {
  PostFileList,
  PostImageGrid,
} from "~/features/posts/components/post-attachments";
import { splitPostAttachments } from "~/features/posts/model/attachments";
import { PostBodyClamp } from "~/features/posts/components/post-body-clamp";
import { PostMarkdown } from "~/features/posts/components/post-markdown";
import { GroupPostHeader } from "~/features/posts/components/group/group-post-header";
import { GroupPostMenu } from "~/features/posts/components/group/group-post-menu";
import { FROM_GROUP, groupPostPath } from "~/features/posts/model/navigation";
import type { GroupPost } from "~/features/posts/model/types";

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
  const postPath = groupPostPath(slug, post.post_id);
  const { images, files } = splitPostAttachments(post.attachments);

  return (
    <article className="overflow-hidden border-b-2 border-foreground/20 bg-card shadow-none md:rounded-xl md:border md:border-border md:shadow-sm">
      {post.is_pinned ? (
        <div className="flex items-center gap-1.5 px-4 pt-3 text-xs font-semibold text-muted-foreground">
          <PinIcon className="size-3.5 -rotate-45 fill-current" />
          고정된 게시물
        </div>
      ) : null}

      <GroupPostHeader
        post={post}
        showCategory
        className="px-4 py-3"
        menu={
          <GroupPostMenu
            post={post}
            slug={slug}
            onPin={onPin}
            onDelete={onDelete}
          />
        }
      />

      <div className="px-4">
        {/* 그룹 이름이 h1이라 제목은 h2다. */}
        <h2 className="mb-2 text-xl font-semibold">
          <Link to={postPath} state={FROM_GROUP} className="hover:underline">
            {post.title}
          </Link>
        </h2>
        <PostBodyClamp postId={post.post_id} testId="group-post-body">
          <PostMarkdown mentions={post.mentions}>{post.body}</PostMarkdown>
        </PostBodyClamp>
      </div>

      <PostImageGrid images={images} className="mt-3" />
      {files.length > 0 ? (
        <div className="mt-3 px-4">
          <PostFileList files={files} />
        </div>
      ) : null}

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
