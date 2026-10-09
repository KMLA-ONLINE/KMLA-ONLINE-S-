import { CheckIcon, XIcon } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { searchGroupMentionCandidates } from "~/features/posts/data/queries";
import {
  MENTION_LIMIT,
  type MentionCandidate,
} from "~/features/posts/model/mentions";
import { formatCohort } from "~/features/profiles";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { cn } from "~/shared/lib/utils";

/** 검색 dialog(`group/group-post-search-dialog.tsx`)와 같은 껍데기 규칙을 쓴다. */
const PICKER_DIALOG_CLASS =
  "flex h-[70svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-md [&_[data-slot=dialog-close]]:top-2";

/** 기수가 없는 선생님은 화면에서도 `선생님`으로 부른다. 검색도 그 말로 걸린다. */
function candidateLabel(candidate: MentionCandidate): string {
  if (candidate.profile_type === "teacher") return "선생님";
  return formatCohort(candidate.cohort, candidate.is_returning_student) ?? "";
}

interface CandidateResult {
  query: string;
  candidates: MentionCandidate[];
  error: string | null;
}

/**
 * 멘션할 사람을 고르는 화면(기능 명세 §8.14). `@` 자동완성 대신 두 입력기가 이 dialog를 함께 쓰며, 열려 있는 동안에만 마운트해 검색어가 남지 않는다.
 * 여러 명을 골라 한 번에 넣는다. 고른 사람은 검색 결과가 아니라 따로 들고 있어 검색어를 바꿔도 남는다.
 */
export function MentionPickerDialog({
  groupId,
  onOpenChange,
  onSelect,
  remaining,
  activeTargetPubIds,
}: {
  groupId: string;
  onOpenChange: (open: boolean) => void;
  /** 고른 순서대로 넘긴다. */
  onSelect: (candidates: MentionCandidate[]) => void;
  /** 더 부를 수 있는 사람 수. 0이어도 이미 부른 사람은 다시 고를 수 있다. */
  remaining: number;
  /** 이미 본문에 남아 있어 상한에서도 다시 고를 수 있는 대상. */
  activeTargetPubIds: string[];
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<CandidateResult | null>(null);
  // Map은 넣은 순서를 지키므로 고른 순서가 본문에 들어가는 순서가 된다.
  const [selected, setSelected] = useState<Map<string, MentionCandidate>>(
    () => new Map(),
  );
  // 로딩은 상태가 아니라 파생값이다. effect 안에서 곧바로 setState 하면 렌더가 한 번 더 돈다.
  const loading = result?.query !== submitted;

  useEffect(() => {
    let cancelled = false;
    searchGroupMentionCandidates(groupId, submitted)
      .then((candidates) => {
        if (!cancelled)
          setResult({ query: submitted, candidates, error: null });
      })
      .catch(() => {
        if (!cancelled) {
          setResult({
            query: submitted,
            candidates: [],
            error: "멤버를 불러오지 못했습니다.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [groupId, submitted]);

  // 한글 조합이 끝난 뒤 제출한다(기능 명세 §8.9와 같은 규칙).
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(query.trim());
  };

  const candidates = result?.candidates ?? [];
  // 이미 본문에 있는 사람은 다시 넣어도 상한을 쓰지 않는다.
  const newlySelected = [...selected.keys()].filter(
    (pubId) => !activeTargetPubIds.includes(pubId),
  ).length;
  const full = newlySelected >= remaining;

  const toggle = (candidate: MentionCandidate) => {
    setSelected((current) => {
      const next = new Map(current);
      if (!next.delete(candidate.pub_id)) next.set(candidate.pub_id, candidate);
      return next;
    });
  };

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className={PICKER_DIALOG_CLASS}>
        <DialogHeader className="border-b p-4">
          <DialogTitle>멘션할 멤버</DialogTitle>
          {full ? (
            <DialogDescription>
              한 게시물에 최대 {MENTION_LIMIT}명까지 부를 수 있습니다.
            </DialogDescription>
          ) : null}
        </DialogHeader>

        {selected.size > 0 ? (
          <ul
            aria-label="고른 멤버"
            className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto border-b p-3"
          >
            {[...selected.values()].map((candidate) => (
              <li key={candidate.pub_id}>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  aria-label={`${candidate.name} 빼기`}
                  className="gap-1 rounded-full"
                  onClick={() => toggle(candidate)}
                >
                  {candidate.name}
                  <XIcon />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        <form className="border-b p-3" onSubmit={submit}>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="이름 또는 기수"
            aria-label="멤버 검색"
          />
        </form>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center p-6">
              <Spinner />
            </div>
          ) : null}
          {!loading && result?.error ? (
            <p className="p-4 text-sm text-destructive">{result.error}</p>
          ) : null}
          {!loading && !result?.error && candidates.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              찾는 멤버가 없습니다.
            </p>
          ) : null}
          {loading ? null : (
            <ul>
              {candidates.map((candidate) => {
                const label = candidateLabel(candidate);
                const isSelected = selected.has(candidate.pub_id);
                return (
                  <li key={candidate.pub_id}>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-pressed={isSelected}
                      disabled={
                        full &&
                        !isSelected &&
                        !activeTargetPubIds.includes(candidate.pub_id)
                      }
                      className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3"
                      onClick={() => toggle(candidate)}
                    >
                      <UserAvatar
                        src={candidate.avatar_url}
                        name={candidate.name}
                      />
                      <span className="truncate font-medium">
                        {candidate.name}
                      </span>
                      {label ? (
                        <span className="text-sm text-muted-foreground">
                          {label}
                        </span>
                      ) : null}
                      <span
                        aria-hidden
                        className={cn(
                          "ml-auto flex size-5 shrink-0 items-center justify-center rounded-full border",
                          isSelected &&
                            "border-primary bg-primary text-primary-foreground",
                        )}
                      >
                        {isSelected ? <CheckIcon className="size-3.5" /> : null}
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter className="border-t p-3 max-md:pb-[max(0.75rem,env(safe-area-inset-bottom))]">
          <Button
            type="button"
            disabled={selected.size === 0}
            onClick={() => onSelect([...selected.values()])}
          >
            {selected.size > 0 ? `${selected.size}명 멘션` : "멘션"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
