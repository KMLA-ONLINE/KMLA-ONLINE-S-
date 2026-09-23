import { useEffect, useState } from "react";

import { resolveRecentSearchEntryUrls } from "~/features/search/data/queries";
import {
  readRecentSearchEntries,
  type RecentSearchEntry,
} from "~/features/search/model/recent-searches";

export interface ResolvedRecentSearchEntry extends RecentSearchEntry {
  avatarUrl: string | null;
}

/** `active`가 켜지는 순간(패널이 열리는 순간)에만 한 번 읽고 해석한다 — 검색창이 닫혀
 * 있는 동안 매 렌더마다 localStorage를 다시 읽을 이유가 없다. */
export function useRecentSearchEntries(
  active: boolean,
): ResolvedRecentSearchEntry[] {
  const [entries, setEntries] = useState<ResolvedRecentSearchEntry[]>([]);

  useEffect(() => {
    if (!active) return;

    let current = true;
    const raw = readRecentSearchEntries();
    void resolveRecentSearchEntryUrls(raw).then((urls) => {
      if (!current) return;
      setEntries(
        raw.map((entry) => ({
          ...entry,
          avatarUrl: entry.avatarPath
            ? (urls.get(`${entry.kind}:${entry.avatarPath}`) ?? null)
            : null,
        })),
      );
    });

    return () => {
      current = false;
    };
  }, [active]);

  return entries;
}
