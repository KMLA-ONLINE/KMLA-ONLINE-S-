import type { FeedPost } from "~/features/feed/model/types";

export function FeedScreen({
  posts,
  profileName,
}: {
  posts: FeedPost[];
  profileName: string;
}) {
  return (
    <div className="flex flex-col gap-3 py-3">
      <p className="px-4 text-sm text-muted-foreground">
        {profileName}님, 안녕하세요
      </p>

      {posts.map((post) => (
        <article
          key={post.post_id}
          className="border-y bg-card p-4 md:rounded-lg md:border"
        >
          <h2 className="font-semibold">{post.title}</h2>
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
            {post.content}
          </p>
        </article>
      ))}

      {posts.length === 0 ? (
        <p className="px-4 py-12 text-center text-sm text-muted-foreground">
          아직 게시물이 없습니다.
        </p>
      ) : null}
    </div>
  );
}
