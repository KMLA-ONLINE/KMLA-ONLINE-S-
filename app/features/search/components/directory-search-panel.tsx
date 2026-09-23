import { Link } from "react-router";

import { GroupAvatar } from "~/features/groups/components/group-avatar";
import { useRecentSearchEntries } from "~/features/search/hooks/use-recent-search-entries";
import { addRecentSearchEntry } from "~/features/search/model/recent-searches";
import type {
  DirectoryResult,
  DirectorySearchResult,
} from "~/features/search/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Spinner } from "~/shared/ui/spinner";

export function DirectorySearchPanel({
  query,
  loading,
  result,
  error,
  onNavigate,
}: {
  query: string;
  loading: boolean;
  result: DirectorySearchResult | null;
  error: string | null;
  /** 데스크톱 드롭다운은 결과를 눌렀을 때 패널을 닫아야 하지만, 모바일 전체화면
   * dialog는 페이지 이동만으로 자연히 unmount되므로 넘길 필요가 없다. */
  onNavigate?: () => void;
}) {
  const recentActive = query === "";
  const recentEntries = useRecentSearchEntries(recentActive);

  function selectResult(item: DirectoryResult) {
    addRecentSearchEntry({
      kind: item.kind,
      id: item.id,
      name: item.name,
      avatarPath: item.avatarPath,
    });
    onNavigate?.();
  }

  if (recentActive) {
    if (recentEntries.length === 0) {
      return (
        <p className="p-6 text-center text-sm text-muted-foreground">
          사람이나 그룹 이름으로 검색해 보세요.
        </p>
      );
    }
    return (
      <div className="flex flex-col gap-1 p-2">
        <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
          최근 항목
        </p>
        {recentEntries.map((entry) => (
          <Link
            key={`${entry.kind}:${entry.id}`}
            to={
              entry.kind === "profile"
                ? `/profile/${entry.id}`
                : `/groups/${entry.id}`
            }
            onClick={() => onNavigate?.()}
            className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
          >
            {entry.kind === "profile" ? (
              <UserAvatar src={entry.avatarUrl} name={entry.name} size="sm" />
            ) : (
              <GroupAvatar
                name={entry.name}
                iconPath={entry.avatarUrl}
                className="size-6"
              />
            )}
            <span className="truncate text-sm">{entry.name}</span>
          </Link>
        ))}
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center p-6">
        <Spinner />
      </div>
    );
  }

  if (error) {
    return (
      <p role="alert" className="p-6 text-center text-sm text-destructive">
        {error}
      </p>
    );
  }

  if (!result) return null;

  if (result.people.length === 0 && result.groups.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        &ldquo;{query}&rdquo;에 대한 검색 결과가 없습니다.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-2">
      {result.people.length > 0 ? (
        <section className="flex flex-col gap-1">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
            사람
          </p>
          {result.people.map((person) => (
            <Link
              key={person.id}
              to={`/profile/${person.id}`}
              onClick={() => selectResult(person)}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
            >
              <UserAvatar src={person.avatarUrl} name={person.name} size="sm" />
              <span className="truncate text-sm">{person.name}</span>
            </Link>
          ))}
        </section>
      ) : null}
      {result.groups.length > 0 ? (
        <section className="flex flex-col gap-1">
          <p className="px-2 py-1 text-xs font-medium text-muted-foreground">
            그룹
          </p>
          {result.groups.map((group) => (
            <Link
              key={group.id}
              to={`/groups/${group.id}`}
              onClick={() => selectResult(group)}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-muted"
            >
              <GroupAvatar
                name={group.name}
                iconPath={group.avatarUrl}
                className="size-6"
              />
              <span className="truncate text-sm">{group.name}</span>
            </Link>
          ))}
        </section>
      ) : null}
    </div>
  );
}
