import { SearchIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";

import { PostEditedMark } from "~/features/posts/components/post-edited-mark";
import { searchGroupPosts } from "~/features/posts/data/queries";
import { extractPostPlainText } from "~/features/posts/model/markdown";
import type { GroupPost } from "~/features/posts/model/types";
import { RelativeTime } from "~/shared/components/relative-time";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

/**
 * 모바일에서는 전체화면, 데스크톱에서는 가운데 정렬된 dialog.
 *
 * `max-md:*`가 하는 일은 Base UI의 기본 위치 지정(가운데로 translate)을 되돌리는 것이다.
 * `bg-background ring-0`은 vendored `DialogContent`의 `bg-popover`/`ring-1`을 덮는다 —
 * 전체화면 시트에서 팝오버 색과 링은 어울리지 않는다. 높이 단위가 `svh`인 것은 모바일
 * 브라우저의 주소창이 접힐 때 화면이 튀지 않게 하기 위해서다.
 */
const SEARCH_DIALOG_CLASS =
  "modal-sheet flex h-[85svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-lg";

export function GroupPostSearchDialog({
  open,
  onOpenChange,
  groupId,
  slug,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groupId: string;
  slug: string;
}) {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [results, setResults] = useState<GroupPost[]>([]);
  const [composing, setComposing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // `autoFocus` 속성 대신 직접 포커스를 옮긴다. 속성은 마운트 시점이 브라우저마다 달라
  // dialog가 자리를 잡기 전에 발동하면 화면이 한 번 스크롤된다.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const close = () => {
    onOpenChange(false);
    // 닫으면 검색어와 결과를 버린다(기능 명세 §8.9). 다시 열었을 때 지난 검색이 남아 있으면
    // 지금 목록과 무관한 결과를 보고 있게 된다.
    setQuery("");
    setSubmittedQuery("");
    setResults([]);
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    // 한글 조합 중의 Enter는 글자를 확정하는 키다. 여기서 제출하면 "ㄱ"으로 검색된다.
    if (composing) return;

    const normalized = query.normalize("NFC").trim();
    if (!normalized) return;

    setLoading(true);
    setError(null);
    try {
      setResults(await searchGroupPosts(groupId, normalized));
      setSubmittedQuery(normalized);
    } catch {
      setError("검색 결과를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent showCloseButton={false} className={SEARCH_DIALOG_CLASS}>
        <DialogHeader className="flex-row items-center gap-2 border-b p-3">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="검색 닫기"
            onClick={close}
          >
            <XIcon />
          </Button>
          <form onSubmit={(event) => void submit(event)} className="flex-1">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onCompositionStart={() => setComposing(true)}
                onCompositionEnd={(event) => {
                  setQuery(event.currentTarget.value);
                  setComposing(false);
                }}
                autoComplete="off"
                placeholder="게시물 검색"
                aria-label="게시물 검색어"
                className="h-9 rounded-full border-0 bg-muted pl-9 shadow-none"
              />
            </div>
          </form>
          {/* 검색창 자체가 헤더라서 보이는 제목은 없다. 낭독기에는 따로 알려준다. */}
          <DialogTitle className="sr-only">게시물 검색</DialogTitle>
          <DialogDescription className="sr-only">
            이 그룹의 게시물을 제목과 본문으로 검색합니다.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center p-8">
              <Spinner />
            </div>
          ) : error ? (
            <p
              role="alert"
              className="p-8 text-center text-sm text-destructive"
            >
              {error}
            </p>
          ) : !submittedQuery ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              제목이나 내용으로 검색해 보세요.
            </p>
          ) : results.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted-foreground">
              &ldquo;{submittedQuery}&rdquo;에 대한 검색 결과가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border/70">
              {results.map((post) => (
                <li key={post.post_id}>
                  <Link
                    to={`/groups/${slug}/posts/${post.post_id}`}
                    onClick={close}
                    className="flex flex-col gap-1 px-4 py-3 transition-colors hover:bg-muted/60"
                  >
                    <div className="flex items-center gap-2">
                      {post.category_name ? (
                        <Badge variant="secondary" className="shrink-0">
                          {post.category_name}
                        </Badge>
                      ) : null}
                      <p className="line-clamp-1 text-sm font-medium">
                        {post.title}
                      </p>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {extractPostPlainText(post.body)}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">
                        {post.author_name || post.author_label}
                      </span>
                      <span aria-hidden="true">·</span>
                      <RelativeTime value={post.published_at} />
                      <PostEditedMark at={post.edited_at} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
