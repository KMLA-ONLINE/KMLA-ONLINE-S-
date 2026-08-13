import {
  LayoutGridIcon,
  ListIcon,
  PinIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { startTransition, useEffect, useState } from "react";
import { Link, useFetcher } from "react-router";

import {
  listGroupPosts,
  searchGroupPosts,
} from "~/features/posts/data/queries";
import { PostAttachments } from "~/features/posts/components/group-post-overlay";
import { formatPostDate } from "~/features/posts/model/format";
import { extractPostPlainText } from "~/features/posts/model/markdown";
import type {
  GroupCategory,
  GroupPost,
  GroupPostPage,
  PostViewMode,
} from "~/features/posts/model/types";
import {
  readPostViewMode,
  writePostViewMode,
} from "~/features/posts/model/view-preference";
import { cn } from "~/shared/lib/utils";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Card } from "~/shared/ui/card";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

export function GroupPostsPanel({
  groupId,
  slug,
  categories,
  initialPage,
  canCreate,
}: {
  groupId: string;
  slug: string;
  categories: GroupCategory[];
  initialPage: GroupPostPage;
  canCreate: boolean;
}) {
  const mutationFetcher = useFetcher();
  const [posts, setPosts] = useState(initialPage.posts);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<PostViewMode>("card");

  useEffect(() => {
    const timeout = window.setTimeout(() => setViewMode(readPostViewMode()), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const selectCategory = async (nextCategoryId: string | null) => {
    setCategoryId(nextCategoryId);
    setQuery("");
    setLoading(true);
    setError(null);
    try {
      const page = await listGroupPosts(groupId, {
        categoryId: nextCategoryId,
      });
      startTransition(() => {
        setPosts(page.posts);
        setCursor(page.nextCursor);
      });
    } catch {
      setError("게시물을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const search = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return void selectCategory(categoryId);
    setLoading(true);
    setError(null);
    try {
      const results = await searchGroupPosts(groupId, query);
      startTransition(() => {
        setPosts(results);
        setCursor(null);
      });
    } catch {
      setError("검색 결과를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const loadMore = async () => {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await listGroupPosts(groupId, { categoryId, cursor });
      startTransition(() => {
        setPosts((current) => [...current, ...page.posts]);
        setCursor(page.nextCursor);
      });
    } catch {
      setError("이전 게시물을 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const changeView = (mode: PostViewMode) => {
    setViewMode(mode);
    writePostViewMode(mode);
  };

  return (
    <section aria-label="그룹 게시물" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 px-3 md:px-0">
        <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
          <Button
            size="sm"
            variant={categoryId === null ? "default" : "outline"}
            onClick={() => void selectCategory(null)}
          >
            전체
          </Button>
          {categories.map((category) => (
            <Button
              key={category.id}
              size="sm"
              variant={categoryId === category.id ? "default" : "outline"}
              onClick={() => void selectCategory(category.id)}
            >
              {category.name}
            </Button>
          ))}
        </div>
        {canCreate ? (
          <Button size="sm" render={<Link to={`/groups/${slug}/posts/new`} />}>
            <PlusIcon /> 글쓰기
          </Button>
        ) : null}
      </div>

      <div className="flex gap-2 px-3 md:px-0">
        <form
          onSubmit={(event) => void search(event)}
          className="relative flex-1"
        >
          <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="제목과 본문 검색"
            aria-label="게시물 검색"
            className="pl-9"
          />
        </form>
        <div className="flex rounded-md border p-0.5" aria-label="보기 방식">
          <Button
            size="icon-sm"
            variant={viewMode === "card" ? "secondary" : "ghost"}
            aria-label="카드 보기"
            onClick={() => changeView("card")}
          >
            <LayoutGridIcon />
          </Button>
          <Button
            size="icon-sm"
            variant={viewMode === "list" ? "secondary" : "ghost"}
            aria-label="목록 보기"
            onClick={() => changeView("list")}
          >
            <ListIcon />
          </Button>
        </div>
      </div>

      {error ? (
        <p role="alert" className="px-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {loading && posts.length === 0 ? (
        <div className="flex justify-center py-12">
          <Spinner />
        </div>
      ) : null}
      {!loading && posts.length === 0 ? (
        <Card className="rounded-none border-x-0 p-10 text-center text-sm text-muted-foreground md:rounded-xl md:border">
          {query ? "검색 결과가 없습니다." : "아직 게시물이 없습니다."}
        </Card>
      ) : null}
      <div
        className={cn("grid gap-3", viewMode === "card" && "sm:grid-cols-2")}
      >
        {posts.map((post) => (
          <PostItem
            key={post.post_id}
            post={post}
            slug={slug}
            compact={viewMode === "list"}
            onPin={() =>
              void mutationFetcher.submit(
                {
                  intent: "pin-post",
                  postId: post.post_id,
                  pinned: String(!post.is_pinned),
                },
                { method: "post" },
              )
            }
          />
        ))}
      </div>
      {cursor ? (
        <div className="flex justify-center">
          <Button
            variant="outline"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading ? <Spinner /> : null} 이전 게시물 더 보기
          </Button>
        </div>
      ) : null}
    </section>
  );
}

function PostItem({
  post,
  slug,
  compact,
  onPin,
}: {
  post: GroupPost;
  slug: string;
  compact: boolean;
  onPin: () => void;
}) {
  return (
    <article
      className={cn(
        "relative border bg-card",
        compact
          ? "border-x-0 px-4 py-3 md:rounded-lg md:border"
          : "rounded-none p-4 md:rounded-xl",
      )}
    >
      <Link
        to={`/groups/${slug}/posts/${post.post_id}`}
        className="block pr-9 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
          {post.is_pinned ? (
            <PinIcon className="size-3.5 text-primary" aria-label="고정됨" />
          ) : null}
          <span>{post.category_name || "미분류"}</span>
          <span>·</span>
          <time dateTime={post.published_at}>
            {formatPostDate(post.published_at)}
          </time>
        </div>
        <h3 className="font-semibold">{post.title}</h3>
        <p
          className={cn(
            "mt-2 text-sm whitespace-pre-wrap text-muted-foreground",
            compact ? "line-clamp-1" : "line-clamp-3",
          )}
        >
          {extractPostPlainText(post.body)}
        </p>
        <PostAttachments attachments={post.attachments} compact />
        <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <span>{post.author_name || post.author_label}</span>
          {post.edited_at ? <Badge variant="secondary">수정됨</Badge> : null}
        </div>
      </Link>
      {post.can_pin ? (
        <Button
          className="absolute top-3 right-3"
          size="icon-sm"
          variant="ghost"
          aria-label={post.is_pinned ? "고정 해제" : "게시물 고정"}
          onClick={onPin}
        >
          <PinIcon />
        </Button>
      ) : null}
    </article>
  );
}
