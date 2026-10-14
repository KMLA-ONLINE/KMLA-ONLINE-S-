import { useEffect, useMemo, useRef, useState } from "react";
import { DownloadIcon, SearchIcon, UploadIcon } from "lucide-react";

import { useAppShell } from "~/features/app-shell";
import {
  cancelDonationClaim,
  claimDonationItem,
  createDonationRound,
  importDonationItems,
  loadDonationClaims,
  loadDonationItems,
  loadDonationRounds,
  type DonationItem,
  type DonationRound,
} from "~/features/donations/data/donations";
import {
  downloadDonationResults,
  parseDonationWorkbook,
  type DonationExportRecord,
  type DonationImportPreview,
} from "~/features/donations/model/workbook";
import { DonationRoundManagement } from "~/features/donations/components/round-management";
import { Button } from "~/shared/ui/button";
import { Input } from "~/shared/ui/input";
import { TextField } from "~/shared/ui/text-field";

const formatter = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDate(value: string) {
  return formatter.format(new Date(value));
}

function getError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "처리 중 오류가 발생했습니다.";
}

function toKoreanISO(value: string) {
  if (!value) return null;
  const date = new Date(`${value}:00+09:00`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function DonationsScreen() {
  const { profile } = useAppShell();
  const isAdmin = profile.role === "admin";

  const [rounds, setRounds] = useState<DonationRound[]>([]);
  const [roundId, setRoundId] = useState<number | null>(null);
  const [items, setItems] = useState<DonationItem[]>([]);
  const [claims, setClaims] = useState<DonationExportRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [busyItem, setBusyItem] = useState<number | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [reading, setReading] = useState(false);

  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [now, setNow] = useState(0);

  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("전체");
  const [visibleCount, setVisibleCount] = useState(50);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const [title, setTitle] = useState("");
  const [opensAt, setOpensAt] = useState("");
  const [closesAt, setClosesAt] = useState("");
  const [preview, setPreview] = useState<DonationImportPreview | null>(null);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => {
      setNow(Date.now());
    }, 0);

    const timer = window.setInterval(() => {
      setNow(Date.now());
    }, 30000);

    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshRounds() {
      try {
        const data = await loadDonationRounds();
        if (!active) return;
        setRounds(data);
        setNow(Date.now());
        setRoundId((previous) =>
          isAdmin && data.some((round) => round.id === previous)
            ? previous
            : (data[0]?.id ?? null),
        );
      } catch (e) {
        if (active) setError(getError(e));
      } finally {
        if (active) setLoading(false);
      }
    }

    void refreshRounds();
    const timer = isAdmin
      ? null
      : window.setInterval(() => void refreshRounds(), 30000);

    return () => {
      active = false;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [isAdmin]);

  const selected = rounds.find((round) => round.id === roundId) ?? null;
  const isOpen =
    selected !== null &&
    new Date(selected.opens_at).getTime() <= now &&
    now < new Date(selected.closes_at).getTime();

  useEffect(() => {
    if (roundId === null) {
      const timer = window.setTimeout(() => {
        setItems([]);
        setClaims([]);
      }, 0);
      return () => window.clearTimeout(timer);
    }

    let active = true;

    queueMicrotask(() => {
      if (!active) return;
      setItemsLoading(true);
      setItems([]);
    });

    Promise.all([
      loadDonationItems(roundId),
      isAdmin ? loadDonationClaims(roundId) : Promise.resolve([]),
    ])
      .then(([nextItems, nextClaims]) => {
        if (!active) return;
        setItems(nextItems);
        setClaims(nextClaims);
      })
      .catch((e: unknown) => {
        if (active) setError(getError(e));
      })
      .finally(() => {
        if (active) setItemsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [roundId, isAdmin, isOpen]);

  const categories = useMemo(
    () => ["전체", ...new Set(items.map((item) => item.category))],
    [items],
  );

  const filtered = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    return items.filter((item) => {
      if (category !== "전체" && item.category !== category) {
        return false;
      }

      return `${item.name} ${item.detail ?? ""}`
        .toLowerCase()
        .includes(keyword);
    });
  }, [items, category, search]);

  useEffect(() => {
    const target = loadMoreRef.current;

    if (!target || visibleCount >= filtered.length) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisibleCount((count) => Math.min(count + 50, filtered.length));
        }
      },
      {
        rootMargin: "350px 0px",
        threshold: 0,
      },
    );

    observer.observe(target);

    return () => observer.disconnect();
  }, [visibleCount, filtered.length]);

  async function reload(id: number) {
    const [nextItems, nextClaims] = await Promise.all([
      loadDonationItems(id),
      isAdmin ? loadDonationClaims(id) : Promise.resolve([]),
    ]);

    setItems(nextItems);
    setClaims(nextClaims);
  }

  async function handleApplication(item: DonationItem) {
    if (!selected || !isOpen || busyItem !== null) return;

    if (
      item.is_mine &&
      !window.confirm(
        "신청을 취소할까요? 취소하면 다른 학생이 신청할 수 있습니다.",
      )
    ) {
      return;
    }

    setBusyItem(item.id);
    setError("");
    setNotice("");

    try {
      if (item.is_mine) {
        await cancelDonationClaim(item.id);
      } else {
        await claimDonationItem(item.id);
      }

      await reload(selected.id);

      setNotice(
        item.is_mine ? "신청이 취소되었습니다." : "신청이 완료되었습니다.",
      );
    } catch (e) {
      setError(getError(e));
      await reload(selected.id).catch(() => undefined);
    } finally {
      setBusyItem(null);
    }
  }

  async function handleCreateRound() {
    const start = toKoreanISO(opensAt);
    const end = toKoreanISO(closesAt);

    if (!title.trim() || !start || !end || start >= end) {
      setError("회차 이름과 신청 시작 및 종료 시간을 확인해주세요.");
      return;
    }

    setAdminBusy(true);
    setError("");
    setNotice("");

    try {
      const newId = await createDonationRound(title.trim(), start, end);

      const updated = await loadDonationRounds();

      setRounds(updated);
      setRoundId(newId);
      setTitle("");
      setOpensAt("");
      setClosesAt("");
      setPreview(null);
      setNotice("회차가 생성되었습니다.");
    } catch (e) {
      setError(getError(e));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleFile(file?: File) {
    setPreview(null);
    setError("");
    setNotice("");

    if (!file) return;

    setReading(true);

    try {
      const result = await parseDonationWorkbook(file);
      setPreview(result);
    } catch (e) {
      setError(getError(e));
    } finally {
      setReading(false);
    }
  }

  async function handleUpload() {
    if (itemsLoading) {
      setError("물품 목록을 불러오는 중입니다. 잠시 후 다시 시도해주세요.");
      return;
    }

    if (selected && items.length > 0) {
      setError(
        "이미 물품이 등록된 회차입니다. 기존 기록을 보호하기 위해 재업로드할 수 없습니다. 새 회차를 만들어 등록해주세요.",
      );
      return;
    }

    if (
      !selected ||
      !preview ||
      preview.errors.length > 0 ||
      preview.items.length === 0
    ) {
      return;
    }

    const confirmed = window.confirm(
      `${preview.items.length}개 물품을 등록할까요? 다른 회차의 물품과 신청 기록은 보존됩니다.`,
    );

    if (!confirmed) return;

    setAdminBusy(true);
    setError("");
    setNotice("");

    try {
      const count = await importDonationItems(selected.id, preview.items);

      await reload(selected.id);
      setPreview(null);
      setNotice(`${count}개 물품을 등록했습니다.`);
    } catch (e) {
      setError(getError(e));
    } finally {
      setAdminBusy(false);
    }
  }

  async function handleDownload() {
    if (!selected) return;

    setAdminBusy(true);
    setError("");

    try {
      const result = await loadDonationClaims(selected.id);
      setClaims(result);

      await downloadDonationResults(result, selected.title);

      setNotice("신청 결과 엑셀 파일을 저장했습니다.");
    } catch (e) {
      setError(getError(e));
    } finally {
      setAdminBusy(false);
    }
  }

  const activeClaims = claims.filter(
    (claim) => claim.applied_at !== null && claim.cancelled_at === null,
  ).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5 p-4 md:py-5">
      <h1 className="hidden text-2xl font-semibold md:block">기부물품</h1>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-3 text-sm text-destructive"
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          className="rounded-lg border bg-muted/40 p-3 text-sm"
        >
          {notice}
        </div>
      )}

      {isAdmin && (
        <section className="space-y-4 rounded-xl border bg-card p-4">
          <h2 className="font-semibold">회차 관리</h2>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="space-y-1 text-sm" htmlFor="donation-field-366">
              <span>회차 이름</span>
              <TextField
                value={title}
                placeholder="예: 2026년 2학기"
                maxLength={100}
                onChange={(e) => setTitle(e.currentTarget.value)}
                id="donation-field-366"
              />
            </label>

            <label className="space-y-1 text-sm" htmlFor="donation-field-376">
              <span>신청 시작 (한국 시간)</span>
              <Input
                type="datetime-local"
                value={opensAt}
                onChange={(e) => setOpensAt(e.currentTarget.value)}
                id="donation-field-376"
              />
            </label>

            <label className="space-y-1 text-sm" htmlFor="donation-field-385">
              <span>신청 종료 (한국 시간)</span>
              <Input
                type="datetime-local"
                value={closesAt}
                onChange={(e) => setClosesAt(e.currentTarget.value)}
                id="donation-field-385"
              />
            </label>
          </div>

          <Button
            type="button"
            disabled={adminBusy}
            onClick={() => {
              void handleCreateRound();
            }}
          >
            회차 생성
          </Button>

          {rounds.length > 0 && (
            <label className="block space-y-1 text-sm">
              <span>회차 선택 · 이전 기록</span>
              <select
                className="h-9 w-full rounded-md border bg-background px-3 text-foreground"
                disabled={adminBusy || reading || busyItem !== null}
                value={roundId ?? ""}
                onChange={(e) => {
                  setItems([]);
                  setClaims([]);
                  setItemsLoading(true);
                  setError("");
                  setNotice("");
                  setRoundId(Number(e.currentTarget.value));
                  setPreview(null);
                  setSearch("");
                  setCategory("전체");
                  setVisibleCount(50);
                }}
              >
                {rounds.map((round) => (
                  <option key={round.id} value={round.id}>
                    {round.title}
                  </option>
                ))}
              </select>
            </label>
          )}
        </section>
      )}

      {isAdmin && selected && (
        <DonationRoundManagement
          key={selected.id}
          round={selected}
          onSaved={async () => {
            setRounds(await loadDonationRounds());
            setError("");
          }}
        />
      )}

      {loading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          불러오는 중입니다.
        </p>
      ) : selected === null ? (
        <div className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
          {isAdmin ? "등록된 회차가 없습니다." : "신청 기간이 아닙니다"}
        </div>
      ) : (
        <>
          {(isAdmin || isOpen) && (
            <section className="rounded-xl border bg-card p-4">
              <h2 className="text-lg font-semibold break-words">
                {selected.title}
              </h2>

              <p className="mt-2 text-sm text-muted-foreground">
                {formatDate(selected.opens_at)}
                {" ~ "}
                {formatDate(selected.closes_at)}
              </p>

              <p className="mt-2 text-sm font-medium">
                {isOpen ? "신청 진행 중 · 선착순" : "신청 기간이 아닙니다"}
              </p>
            </section>
          )}

          {isAdmin && (
            <section className="space-y-4 rounded-xl border bg-card p-4">
              <h2 className="font-semibold">엑셀 일괄등록</h2>

              <Input
                type="file"
                accept=".xlsx"
                aria-label="물품 엑셀 파일"
                disabled={
                  adminBusy || reading || itemsLoading || items.length > 0
                }
                onChange={(e) => {
                  void handleFile(e.currentTarget.files?.[0]);
                }}
              />

              {reading && (
                <p className="text-sm">엑셀 파일을 검사하는 중입니다.</p>
              )}

              {preview && (
                <div className="space-y-2 text-sm" aria-live="polite">
                  <p>
                    물품 {preview.items.length}개 · 오류 {preview.errors.length}
                    건
                  </p>

                  {preview.errors.length > 0 && (
                    <div
                      role="alert"
                      className="max-h-48 overflow-y-auto rounded-lg border border-destructive/30 p-3"
                    >
                      {preview.errors.map((issue, index) => (
                        <p key={index}>{issue}</p>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <Button
                type="button"
                disabled={
                  adminBusy ||
                  itemsLoading ||
                  items.length > 0 ||
                  reading ||
                  !preview ||
                  preview.errors.length > 0 ||
                  preview.items.length === 0
                }
                onClick={() => {
                  void handleUpload();
                }}
              >
                <UploadIcon aria-hidden />
                물품 등록
              </Button>

              <div className="border-t pt-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="font-semibold">신청 내역</h3>
                    <p className="text-sm text-muted-foreground">
                      물품 {items.length}개 · 신청 {activeClaims}건
                    </p>
                  </div>

                  <Button
                    type="button"
                    variant="outline"
                    disabled={adminBusy}
                    onClick={() => {
                      void handleDownload();
                    }}
                  >
                    <DownloadIcon aria-hidden />
                    엑셀 다운로드
                  </Button>
                </div>

                <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border">
                  {claims
                    .filter((claim) => claim.applied_at !== null)
                    .map((claim) => (
                      <div
                        key={`${claim.item_id}-${claim.applied_at}`}
                        className="border-b p-3 text-sm last:border-0"
                      >
                        <span className="font-medium">{claim.item_name}</span>
                        {" · "}
                        {claim.applicant ?? "알 수 없음"}
                        {" · "}
                        {claim.cancelled_at ? "취소" : "신청"}
                        <p className="mt-1 text-xs break-words text-muted-foreground">
                          {formatDate(claim.applied_at!)}
                          {claim.cancelled_at
                            ? ` · 취소 ${formatDate(claim.cancelled_at)}`
                            : ""}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            </section>
          )}

          {!isOpen && !isAdmin ? (
            <div className="rounded-xl border p-8 text-center font-medium">
              신청 기간이 아닙니다
            </div>
          ) : (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">물품 목록 ({items.length})</h2>

                <div className="relative w-full sm:w-64">
                  <SearchIcon
                    aria-hidden
                    className="absolute top-2.5 left-3 size-4 text-muted-foreground"
                  />
                  <Input
                    type="search"
                    aria-label="물품 검색"
                    placeholder="물품명 검색…"
                    className="pl-9"
                    value={search}
                    onChange={(e) => {
                      setSearch(e.currentTarget.value);
                      setVisibleCount(50);
                    }}
                  />
                </div>
              </div>

              <select
                aria-label="물품 분류"
                className="h-9 w-full rounded-md border bg-background px-3 sm:w-64"
                value={category}
                onChange={(e) => {
                  setCategory(e.currentTarget.value);
                  setVisibleCount(50);
                }}
              >
                {categories.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>

              {itemsLoading ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  물품을 불러오는 중입니다.
                </p>
              ) : filtered.length === 0 ? (
                <p className="rounded-xl border p-8 text-center text-sm text-muted-foreground">
                  표시할 물품이 없습니다.
                </p>
              ) : (
                <div className="overflow-hidden rounded-xl border bg-card">
                  <div
                    className={`hidden items-center gap-4 border-b bg-muted/40 px-4 py-3 text-sm font-medium md:grid ${
                      isAdmin
                        ? "md:grid-cols-[8rem_minmax(0,1fr)_7rem]"
                        : "md:grid-cols-[8rem_minmax(0,1fr)_7rem_8rem]"
                    }`}
                  >
                    <span>분류</span>
                    <span>물품명</span>
                    <span>상태</span>
                    {!isAdmin && <span className="text-right">신청</span>}
                  </div>

                  <div className="divide-y">
                    {filtered.slice(0, visibleCount).map((item) => (
                      <div
                        key={item.id}
                        className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 transition-colors [contain-intrinsic-size:auto_84px] [content-visibility:auto] hover:bg-muted/30 md:gap-4 ${
                          isAdmin
                            ? "md:grid-cols-[8rem_minmax(0,1fr)_7rem]"
                            : "md:grid-cols-[8rem_minmax(0,1fr)_7rem_8rem]"
                        }`}
                      >
                        <div className="col-span-2 text-xs text-muted-foreground md:col-span-1 md:text-sm">
                          {item.category}
                        </div>

                        <div className="col-span-2 min-w-0 md:col-span-1">
                          <p className="text-sm font-medium break-words">
                            {item.name}
                          </p>

                          {item.detail && item.detail !== item.name && (
                            <p className="mt-1 text-xs break-words text-muted-foreground">
                              {item.detail}
                            </p>
                          )}

                          {isAdmin && item.donor_name && (
                            <p className="mt-1 text-xs break-words text-muted-foreground">
                              기증자: {item.donor_name}
                            </p>
                          )}
                        </div>

                        <div className="text-xs text-muted-foreground md:text-sm">
                          {item.is_mine
                            ? "내 신청"
                            : item.is_claimed
                              ? "신청 완료"
                              : "신청 가능"}
                        </div>

                        {!isAdmin && (
                          <div className="flex justify-end">
                            {item.is_claimed && !item.is_mine ? (
                              <span className="text-right text-sm font-medium text-muted-foreground">
                                {item.claimant_name
                                  ? `${item.claimant_cohort === null ? "" : `${item.claimant_cohort}기 `}${item.claimant_name}`
                                  : null}
                              </span>
                            ) : isOpen ? (
                              <Button
                                type="button"
                                size="sm"
                                className="min-w-24"
                                variant={item.is_mine ? "outline" : "default"}
                                disabled={busyItem !== null}
                                onClick={() => {
                                  void handleApplication(item);
                                }}
                              >
                                {busyItem === item.id
                                  ? "처리 중"
                                  : item.is_mine
                                    ? "신청 취소"
                                    : "신청하기"}
                              </Button>
                            ) : (
                              <span className="text-xs text-muted-foreground">
                                신청 기간이 아닙니다
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {filtered.length > visibleCount && (
                <div
                  ref={loadMoreRef}
                  aria-hidden="true"
                  className="h-1 w-full"
                />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
