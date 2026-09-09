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
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";

/** 검색 dialog(`group/group-post-search-dialog.tsx`)와 같은 껍데기 규칙을 쓴다. */
const PICKER_DIALOG_CLASS =
  "flex h-[70svh] flex-col gap-0 overflow-hidden bg-background p-0 ring-0 max-md:top-0 max-md:left-0 max-md:h-svh max-md:max-h-svh max-md:max-w-full max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-none md:max-w-md";

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
 * 멘션할 사람을 고르는 화면(기능 명세 §8.14).
 *
 * `@` 자동완성 대신 버튼으로 연다. 본문 편집기가 셋(데스크톱 Milkdown, 모바일 textarea, 댓글
 * 입력창)이라 자동완성은 각각에 붙여야 하고 한글 조합 중 입력까지 다뤄야 하지만, 이 시트는
 * 셋이 그대로 함께 쓴다.
 *
 * 열려 있는 동안에만 마운트한다(`MentionButton`). 그래서 닫았다 열면 검색어와 결과가 저절로
 * 비고, 상태를 되돌리는 effect 를 두지 않아도 된다.
 */
export function MentionPickerDialog({
  groupId,
  onOpenChange,
  onSelect,
  remaining,
}: {
  groupId: string;
  onOpenChange: (open: boolean) => void;
  onSelect: (candidate: MentionCandidate) => void;
  /** 더 부를 수 있는 사람 수. 0이면 고를 수 없다. */
  remaining: number;
}) {
  const [query, setQuery] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [result, setResult] = useState<CandidateResult | null>(null);
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

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className={PICKER_DIALOG_CLASS}>
        <DialogHeader className="border-b p-4">
          <DialogTitle>멘션할 멤버</DialogTitle>
          <DialogDescription>
            {remaining > 0
              ? `이름이나 기수로 찾습니다. ${remaining}명 더 부를 수 있습니다.`
              : `한 게시물에 최대 ${MENTION_LIMIT}명까지 부를 수 있습니다.`}
          </DialogDescription>
        </DialogHeader>

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
                return (
                  <li key={candidate.pub_id}>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={remaining <= 0}
                      className="h-auto w-full justify-start gap-3 rounded-none px-4 py-3"
                      onClick={() => onSelect(candidate)}
                    >
                      <UserAvatar
                        src={candidate.avatar_path}
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
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
