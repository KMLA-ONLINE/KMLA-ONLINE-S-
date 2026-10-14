import { getSupabase } from "~/shared/supabase/client";
import type {
  DonationExportRecord,
  DonationUploadItem,
} from "~/features/donations/model/workbook";

export interface DonationRound {
  id: number;
  title: string;
  opens_at: string;
  closes_at: string;
}

export interface DonationItem {
  id: number;
  category: string;
  name: string;
  detail: string | null;
  donor_name: string | null;
  is_claimed: boolean;
  is_mine: boolean;
  claimant_name: string | null;
  claimant_cohort: number | null;
}

function handleError(error: { code?: string; message: string }): never {
  if (error.code === "23505") {
    throw new Error("이미 다른 학생이 신청한 물품입니다.");
  }

  if (error.code === "42501") {
    throw new Error("접근 권한이 없습니다.");
  }

  if (
    error.message.includes("applications are closed") ||
    error.message.includes("period closed")
  ) {
    throw new Error("신청 기간이 아닙니다.");
  }

  if (error.message.includes("donation rounds cannot overlap")) {
    throw new Error("다른 회차와 신청 기간이 겹칩니다.");
  }

  if (error.message.includes("items already imported")) {
    throw new Error("이미 물품이 등록된 회차입니다. 새 회차에 업로드해주세요.");
  }

  if (error.message.includes("round not found or closed")) {
    throw new Error("신청이 종료된 회차에는 업로드할 수 없습니다.");
  }

  if (error.message.includes("invalid donation round")) {
    throw new Error("회차 이름과 신청 기간을 확인해주세요.");
  }

  throw new Error(error.message);
}

export async function loadDonationRounds(): Promise<DonationRound[]> {
  const { data, error } = await getSupabase().rpc("donation_list_rounds");

  if (error) handleError(error);
  return data ?? [];
}

export async function loadDonationItems(
  roundId: number,
): Promise<DonationItem[]> {
  const items: Omit<DonationItem, "claimant_name" | "claimant_cohort">[] = [];

  for (let start = 0; ; start += 500) {
    const { data, error } = await getSupabase()
      .rpc("donation_list_items", { p_round_id: roundId })
      .range(start, start + 499);

    if (error) handleError(error);

    const chunk = data ?? [];
    items.push(...chunk);

    if (chunk.length < 500) break;
  }

  const occupants: {
    item_id: number;
    applicant_name: string | null;
    applicant_cohort: number | null;
  }[] = [];

  for (let start = 0; ; start += 500) {
    const { data, error } = await getSupabase()
      .rpc("donation_list_claimed_by", { p_round_id: roundId })
      .range(start, start + 499);

    if (error) handleError(error);

    const chunk = data ?? [];
    occupants.push(...chunk);

    if (chunk.length < 500) break;
  }

  const byItem = new Map(occupants.map((person) => [person.item_id, person]));

  return items.map((item) => ({
    ...item,
    claimant_name: byItem.get(item.id)?.applicant_name ?? null,
    claimant_cohort: byItem.get(item.id)?.applicant_cohort ?? null,
  }));
}

export async function createDonationRound(
  title: string,
  opensAt: string,
  closesAt: string,
): Promise<number> {
  const { data, error } = await getSupabase().rpc("donation_create_round", {
    p_title: title,
    p_opens_at: opensAt,
    p_closes_at: closesAt,
  });

  if (error) handleError(error);
  return data;
}

export async function importDonationItems(
  roundId: number,
  items: DonationUploadItem[],
): Promise<number> {
  const { data, error } = await getSupabase().rpc("donation_import_items", {
    p_round_id: roundId,
    p_items: items.map((item) => ({ ...item })),
  });

  if (error) handleError(error);
  return data;
}

export async function claimDonationItem(itemId: number): Promise<void> {
  const { error } = await getSupabase().rpc("donation_claim_item", {
    p_item_id: itemId,
  });

  if (error) handleError(error);
}

export async function cancelDonationClaim(itemId: number): Promise<void> {
  const { error } = await getSupabase().rpc("donation_cancel_claim", {
    p_item_id: itemId,
  });

  if (error) handleError(error);
}

export async function loadDonationClaims(
  roundId: number,
): Promise<DonationExportRecord[]> {
  const records: DonationExportRecord[] = [];

  for (let start = 0; ; start += 500) {
    const { data, error } = await getSupabase()
      .rpc("donation_list_claims", { p_round_id: roundId })
      .range(start, start + 499);

    if (error) handleError(error);

    const chunk = data ?? [];
    records.push(...chunk);

    if (chunk.length < 500) break;
  }

  return records;
}

export async function updateDonationRound(
  roundId: number,
  title: string,
  opensAt: string,
  closesAt: string,
): Promise<void> {
  const { error } = await getSupabase().rpc("donation_update_round", {
    p_round_id: roundId,
    p_title: title,
    p_opens_at: opensAt,
    p_closes_at: closesAt,
  });

  if (error) handleError(error);
}
