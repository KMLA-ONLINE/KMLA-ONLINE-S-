import { useEffect, useMemo, useRef, useState } from "react";
import { SearchIcon } from "lucide-react";

import type { DonationItem } from "~/features/donations/data/donations";
import { Badge } from "~/shared/ui/badge";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { cn } from "~/shared/lib/utils";

export const CLAIM_LIMIT = 50;
const PAGE_SIZE = 50;

type StatusFilter = "all" | "available" | "claimed" | "mine";

export interface Claimant {
  name: string | null;
  cohort: number | null;
}

interface Props {
  items: DonationItem[];
  loading: boolean;
  /** Admins also see donors and every applicant. */
  isAdmin: boolean;
  /** Only current students apply; teachers and alumni browse. */
  canApply: boolean;
  isOpen: boolean;
  busyItem: number | null;
  mineCount: number;
  claimants?: ReadonlyMap<number, Claimant>;
  onClaim?: (item: DonationItem) => void;
  onCancel?: (item: DonationItem) => void;
}

function formatClaimant(claimant: Claimant | undefined) {
  if (!claimant?.name) return null;
  return claimant.cohort === null
    ? claimant.name
    : `${claimant.cohort}기 ${claimant.name}`;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-8 shrink-0 rounded-full border px-3 text-sm whitespace-nowrap transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "bg-background text-muted-foreground hover:bg-muted",
      )}
    >
      {children}
    </button>
  );
}

export function DonationItemList({
  items,
  loading,
  isAdmin,
  canApply,
  isOpen,
  busyItem,
  mineCount,
  claimants,
  onClaim,
  onCancel,
}: Props) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [category, setCategory] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const categories = useMemo(
    () => [...new Set(items.map((item) => item.category))],
    [items],
  );

  const counts = useMemo(() => {
    let claimed = 0;
    let mine = 0;
    for (const item of items) {
      if (item.is_claimed) claimed += 1;
      if (item.is_mine) mine += 1;
    }
    return {
      all: items.length,
      claimed,
      available: items.length - claimed,
      mine,
    };
  }, [items]);

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return items.filter((item) => {
      if (category !== null && item.category !== category) return false;
      if (status === "available" && item.is_claimed) return false;
      if (status === "claimed" && !item.is_claimed) return false;
      if (status === "mine" && !item.is_mine) return false;
      if (!keyword) return true;

      return `${item.name} ${item.detail ?? ""}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, category, status, search]);

  useEffect(() => {
    const target = loadMoreRef.current;

    if (!target || visibleCount >= filtered.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) =>
            Math.min(count + PAGE_SIZE, filtered.length),
          );
        }
      },
      { rootMargin: "350px 0px", threshold: 0 },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  function changeFilter(update: () => void) {
    update();
    setVisibleCount(PAGE_SIZE);
  }

  const statusChips: { value: StatusFilter; label: string; count: number }[] =
    isAdmin
      ? [
          { value: "all", label: "전체", count: counts.all },
          { value: "claimed", label: "신청됨", count: counts.claimed },
          { value: "available", label: "미신청", count: counts.available },
          ...(canApply && counts.mine > 0
            ? [{ value: "mine" as const, label: "내 신청", count: counts.mine }]
            : []),
        ]
      : [
          { value: "all", label: "전체", count: counts.all },
          { value: "available", label: "신청 가능", count: counts.available },
          ...(canApply
            ? [{ value: "mine" as const, label: "내 신청", count: counts.mine }]
            : []),
        ];

  const limitReached = mineCount >= CLAIM_LIMIT;

  function renderAction(item: DonationItem) {
    const claimant = formatClaimant(claimants?.get(item.id));

    // A former applicant keeps the cancel button even after losing access.
    if (item.is_mine) {
      return (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!isOpen || busyItem !== null}
          aria-label={`${item.name} 신청 취소`}
          onClick={() => onCancel?.(item)}
        >
          {busyItem === item.id ? <Spinner data-icon="inline-start" /> : null}
          취소
        </Button>
      );
    }

    if (item.is_claimed) {
      return (
        <span
          className={cn(
            "text-right text-sm break-keep",
            !isAdmin && "text-muted-foreground",
          )}
        >
          {claimant ?? (isAdmin ? "신청됨" : "신청 마감")}
        </span>
      );
    }

    if (canApply && isOpen) {
      return (
        <Button
          type="button"
          size="sm"
          disabled={busyItem !== null || limitReached}
          aria-label={`${item.name} 신청`}
          onClick={() => onClaim?.(item)}
        >
          {busyItem === item.id ? <Spinner data-icon="inline-start" /> : null}
          신청
        </Button>
      );
    }

    return (
      <span className="text-sm text-muted-foreground">
        {isAdmin ? "미신청" : "신청 가능"}
      </span>
    );
  }

  return (
    <section className="space-y-3" aria-label="물품 목록">
      <div className="relative">
        <SearchIcon
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          aria-label="물품 검색"
          placeholder="물품명이나 색상·사이즈로 검색"
          className="pl-9"
          value={search}
          onChange={(e) => {
            const value = e.currentTarget.value;
            changeFilter(() => setSearch(value));
          }}
        />
      </div>

      <div
        role="group"
        aria-label="신청 상태"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
      >
        {statusChips.map((chip) => (
          <Chip
            key={chip.value}
            active={status === chip.value}
            onClick={() => changeFilter(() => setStatus(chip.value))}
          >
            {chip.label} {chip.count}
          </Chip>
        ))}
      </div>

      {categories.length > 1 && (
        <div
          role="group"
          aria-label="물품 분류"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:px-0"
        >
          <Chip
            active={category === null}
            onClick={() => changeFilter(() => setCategory(null))}
          >
            모든 분류
          </Chip>
          {categories.map((name) => (
            <Chip
              key={name}
              active={category === name}
              onClick={() => changeFilter(() => setCategory(name))}
            >
              {name}
            </Chip>
          ))}
        </div>
      )}

      {canApply && limitReached && (
        <p className="rounded-lg bg-muted px-3 py-2 text-sm">
          한 회차에 최대 {CLAIM_LIMIT}개까지 신청할 수 있습니다. 다른 물품을
          신청하려면 기존 신청을 취소해 주세요.
        </p>
      )}

      {loading ? (
        <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
          <Spinner />
          물품을 불러오는 중입니다.
        </p>
      ) : filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {items.length === 0
            ? "등록된 물품이 없습니다."
            : "조건에 맞는 물품이 없습니다."}
        </p>
      ) : (
        <ul className="divide-y overflow-hidden rounded-xl border bg-card">
          {filtered.slice(0, visibleCount).map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-3 px-4 py-3 [contain-intrinsic-size:auto_72px] [content-visibility:auto]",
                item.is_mine && "bg-primary/5",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                  {item.category}
                  {item.is_mine && <Badge>내 신청</Badge>}
                </p>
                <p className="mt-0.5 text-sm font-medium break-words">
                  {item.name}
                </p>
                {item.detail && item.detail !== item.name && (
                  <p className="mt-0.5 text-xs break-words text-muted-foreground">
                    {item.detail}
                  </p>
                )}
                {isAdmin && item.donor_name && (
                  <p className="mt-0.5 text-xs break-words text-muted-foreground">
                    기증자 {item.donor_name}
                  </p>
                )}
              </div>
              <div className="flex max-w-[40%] shrink-0 justify-end">
                {renderAction(item)}
              </div>
            </li>
          ))}
        </ul>
      )}

      {!loading && filtered.length > visibleCount && (
        <div ref={loadMoreRef} aria-hidden="true" className="h-1 w-full" />
      )}
    </section>
  );
}
