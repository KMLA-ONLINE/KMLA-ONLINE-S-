import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { storyKeys } from "~/features/stories/data/cache";
import { deleteMyStory, setMyStory } from "~/features/stories/data/mutations";
import {
  isStoryContentValid,
  normalizeStoryContent,
  STORY_CONTENT_MAX_LENGTH,
} from "~/features/stories/model/story";
import { getQueryClient } from "~/shared/lib/query-client";
import { Button } from "~/shared/ui/button";
import { Textarea } from "~/shared/ui/textarea";

export function StoryEditor({
  initial,
  onSaved,
}: {
  initial: string | null;
  onSaved?: () => void | Promise<void>;
}) {
  const navigate = useNavigate();
  const [content, setContent] = useState(initial ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalizedContent = normalizeStoryContent(content);
  const valid = isStoryContentValid(content);
  const editing = initial !== null;

  async function finish() {
    // 저장·삭제 직후 홈 레일이 예전 목록을 그리지 않도록 캐시를 먼저 버린다.
    await getQueryClient().invalidateQueries({
      queryKey: storyKeys.all,
      refetchType: "none",
    });

    if (onSaved) {
      await onSaved();
    } else {
      await navigate("/");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!valid || pending) return;

    setPending(true);
    setError(null);

    try {
      await setMyStory(normalizedContent);
      await finish();
    } catch {
      setError("저장하지 못했습니다.");
      setPending(false);
    }
  }

  async function remove() {
    if (!editing || pending) return;

    if (!window.confirm("스토리를 삭제할까요?")) {
      return;
    }

    setPending(true);
    setError(null);

    try {
      await deleteMyStory();
      await finish();
    } catch {
      setError("삭제하지 못했습니다.");
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="flex min-w-0 flex-col gap-5"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <div className="flex items-end justify-between gap-4">
          <label htmlFor="story-content" className="text-sm font-medium">
            오늘 한마디
          </label>

          <span className="text-xs text-muted-foreground">
            {normalizedContent.length}/{STORY_CONTENT_MAX_LENGTH}
          </span>
        </div>

        <Textarea
          id="story-content"
          value={content}
          onChange={(event) => setContent(event.currentTarget.value)}
          maxLength={STORY_CONTENT_MAX_LENGTH}
          rows={4}
          placeholder="오늘 무슨 일이 있었나요?"
          aria-invalid={Boolean(content) && !valid}
          disabled={pending}
          className="[field-sizing:fixed] min-h-28 max-w-full min-w-0 resize-none"
        />
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        {editing ? (
          <Button
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={() => void remove()}
          >
            삭제
          </Button>
        ) : (
          <span />
        )}

        <Button type="submit" disabled={!valid || pending}>
          {pending ? "처리 중" : editing ? "수정" : "올리기"}
        </Button>
      </div>
    </form>
  );
}
