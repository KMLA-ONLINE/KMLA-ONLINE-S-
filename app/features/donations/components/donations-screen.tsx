import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { useAppShell } from "~/features/app-shell";
import {
  cancelDonationClaim,
  claimDonationItem,
  loadDonationClaims,
  loadDonationItems,
  loadDonationRounds,
  type DonationItem,
  type DonationRound,
} from "~/features/donations/data/donations";
import type { DonationExportRecord } from "~/features/donations/model/workbook";
import { DonationAdminPanel } from "~/features/donations/components/donation-admin-panel";
import {
  CLAIM_LIMIT,
  DonationItemList,
  type Claimant,
} from "~/features/donations/components/donation-item-list";
import { formatDonationDate } from "~/features/donations/components/round-summary";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { Button } from "~/shared/ui/button";
import { Spinner } from "~/shared/ui/spinner";

function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : "처리 중 오류가 발생했습니다.";
}

/** Admins keep their chosen round; users always follow the server's pick. */
function pickRound(
  rounds: DonationRound[],
  wanted: number | null,
  isAdmin: boolean,
) {
  return isAdmin && rounds.some((round) => round.id === wanted)
    ? wanted
    : (rounds[0]?.id ?? null);
}

/** Applies a claim or cancellation locally until the server list returns. */
function applyLocally(
  items: DonationItem[],
  itemId: number,
  claim: boolean,
): DonationItem[] {
  return items.map((item) =>
    item.id === itemId
      ? {
          ...item,
          is_claimed: claim,
          is_mine: claim,
          claimant_name: null,
          claimant_cohort: null,
        }
      : item,
  );
}

function fetchRound(id: number, isAdmin: boolean) {
  return Promise.all([
    loadDonationItems(id, { includeClaimants: !isAdmin }),
    isAdmin ? loadDonationClaims(id) : Promise.resolve([]),
  ]);
}

function LoadError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
    >
      <span className="min-w-0 break-words">{message}</span>
      <Button type="button" size="sm" variant="outline" onClick={onRetry}>
        다시 시도
      </Button>
    </div>
  );
}

export function DonationsScreen() {
  const { profile } = useAppShell();
  const isAdmin = profile.role === "admin";
  // Mirrors donation_claim_item, which enforces the same rule.
  const canApply = isAdmin || profile.type === "student";

  const [rounds, setRounds] = useState<DonationRound[]>([]);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [checkedAt, setCheckedAt] = useState(0);
  const [items, setItems] = useState<DonationItem[]>([]);
  const [claims, setClaims] = useState<DonationExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [busyItem, setBusyItem] = useState<number | null>(null);
  const [cancelTarget, setCancelTarget] = useState<DonationItem | null>(null);
  // Each error clears on that request's next success, so a transient
  // failure does not linger after a later refresh works.
  const [roundsError, setRoundsError] = useState("");
  const [itemsError, setItemsError] = useState("");
  const [itemsAttempt, setItemsAttempt] = useState(0);

  async function refreshRounds(selectId?: number) {
    const data = await loadDonationRounds();
    setRounds(data);
    setRoundsError("");
    setCheckedAt(Date.now());
    setRoundId((previous) => pickRound(data, selectId ?? previous, isAdmin));
  }

  useEffect(() => {
    let active = true;

    async function poll() {
      try {
        const data = await loadDonationRounds();
        if (!active) return;
        setRounds(data);
        setRoundsError("");
        setCheckedAt(Date.now());
        setRoundId((previous) => pickRound(data, previous, isAdmin));
      } catch (e) {
        if (active) setRoundsError(errorMessage(e));
      } finally {
        if (active) setLoading(false);
      }
    }

    // The server decides whether a round is open, so device clock skew
    // cannot show or hide application buttons out of step with it.
    void poll();
    const timer = window.setInterval(() => void poll(), 30000);

    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [isAdmin]);

  const selected = rounds.find((round) => round.id === roundId) ?? null;
  const isOpen = selected?.is_open ?? false;

  useEffect(() => {
    // Users only ever get items for an open round, so skip the request.
    if (roundId === null || (!isAdmin && !isOpen)) return;

    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      setItemsLoading(true);
      setItemsError("");
      setItems([]);
      setClaims([]);
    });

    fetchRound(roundId, isAdmin)
      .then(([nextItems, nextClaims]) => {
        if (!active) return;
        setItems(nextItems);
        setClaims(nextClaims);
      })
      .catch((e: unknown) => {
        if (active) setItemsError(errorMessage(e));
      })
      .finally(() => {
        if (active) setItemsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [roundId, isAdmin, isOpen, itemsAttempt]);

  async function reload(id: number) {
    const [nextItems, nextClaims] = await fetchRound(id, isAdmin);
    setItems(nextItems);
    setClaims(nextClaims);
    setItemsError("");
  }

  const mineCount = useMemo(
    () => items.filter((item) => item.is_mine).length,
    [items],
  );

  const claimants = useMemo(() => {
    const map = new Map<number, Claimant>();

    if (isAdmin) {
      for (const claim of claims) {
        if (claim.applied_at !== null && claim.cancelled_at === null) {
          map.set(claim.item_id, {
            name: claim.applicant,
            cohort: claim.applicant_cohort,
          });
        }
      }
    } else {
      for (const item of items) {
        if (item.is_claimed && !item.is_mine) {
          map.set(item.id, {
            name: item.claimant_name,
            cohort: item.claimant_cohort,
          });
        }
      }
    }

    return map;
  }, [isAdmin, claims, items]);

  async function changeClaim(item: DonationItem, claim: boolean) {
    if (!selected || busyItem !== null) return;

    const id = selected.id;
    setBusyItem(item.id);
    setItems((current) => applyLocally(current, item.id, claim));

    try {
      if (claim) {
        await claimDonationItem(item.id);
        toast.success(`${item.name} 신청 완료`);
      } else {
        await cancelDonationClaim(item.id);
        toast.success(`${item.name} 신청 취소`);
      }
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusyItem(null);
      setCancelTarget(null);
    }

    // Others may have claimed items meanwhile; the server list is canonical
    // and also rolls back a failed optimistic change.
    await reload(id).catch((e: unknown) => toast.error(errorMessage(e)));
  }

  if (loading) {
    return (
      <p className="flex items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
        <Spinner />
        불러오는 중입니다.
      </p>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 md:py-5">
      <h1 className="hidden text-2xl font-semibold md:block">기부물품</h1>

      {roundsError && (
        <LoadError
          message={roundsError}
          onRetry={() =>
            void refreshRounds().catch((e: unknown) =>
              setRoundsError(errorMessage(e)),
            )
          }
        />
      )}

      {itemsError && (
        <LoadError
          message={itemsError}
          onRetry={() => setItemsAttempt((count) => count + 1)}
        />
      )}

      {isAdmin ? (
        <>
          <DonationAdminPanel
            rounds={rounds}
            selected={selected}
            checkedAt={checkedAt}
            itemCount={items.length}
            itemsLoading={itemsLoading}
            claims={claims}
            onSelectRound={(id) => {
              setItemsError("");
              setRoundId(id);
            }}
            onRoundsChanged={refreshRounds}
            onItemsChanged={async () => {
              if (selected) await reload(selected.id);
            }}
          />
          {selected && (itemsLoading || items.length > 0) && (
            <DonationItemList
              key={selected.id}
              items={items}
              loading={itemsLoading}
              isAdmin
              canApply
              isOpen={isOpen}
              busyItem={busyItem}
              mineCount={mineCount}
              claimants={claimants}
              onClaim={(item) => void changeClaim(item, true)}
              onCancel={setCancelTarget}
            />
          )}
        </>
      ) : roundsError && rounds.length === 0 ? null : selected === null ||
        !isOpen ? (
        <div className="rounded-xl border border-dashed p-10 text-center font-medium">
          신청 기간이 아닙니다
        </div>
      ) : (
        <>
          <section className="rounded-xl border bg-card p-4">
            <h2 className="text-lg font-semibold break-words">
              {selected.title}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDonationDate(selected.closes_at)}까지 · 선착순
            </p>
            {canApply ? (
              <div className="mt-3 flex items-center gap-3">
                <div
                  className="h-2 flex-1 overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-primary transition-[width]"
                    style={{ width: `${(mineCount / CLAIM_LIMIT) * 100}%` }}
                  />
                </div>
                <p className="shrink-0 text-sm tabular-nums">
                  내 신청 <span className="font-semibold">{mineCount}</span>/
                  {CLAIM_LIMIT}
                </p>
              </div>
            ) : (
              <p className="mt-3 rounded-lg bg-muted px-3 py-2 text-sm">
                기부물품은 재학생만 신청할 수 있습니다. 목록은 볼 수 있어요.
              </p>
            )}
          </section>

          <DonationItemList
            key={selected.id}
            items={items}
            loading={itemsLoading}
            isAdmin={false}
            canApply={canApply}
            isOpen={isOpen}
            busyItem={busyItem}
            mineCount={mineCount}
            claimants={claimants}
            onClaim={(item) => void changeClaim(item, true)}
            onCancel={setCancelTarget}
          />
        </>
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="신청 취소"
          description={`${cancelTarget.name} 신청을 취소합니다. 취소하면 다른 학생이 바로 신청할 수 있습니다.`}
          confirmLabel="신청 취소"
          destructive
          pending={busyItem !== null}
          onCancel={() => setCancelTarget(null)}
          onConfirm={() => void changeClaim(cancelTarget, false)}
        />
      )}
    </div>
  );
}
