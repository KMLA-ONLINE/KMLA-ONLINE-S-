import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  DonationItem,
  DonationRound,
} from "~/features/donations/data/donations";

const data = vi.hoisted(() => ({
  loadDonationRounds: vi.fn(),
  loadDonationItems: vi.fn(),
  loadDonationClaims: vi.fn(),
  claimDonationItem: vi.fn(),
  cancelDonationClaim: vi.fn(),
  createDonationRound: vi.fn(),
  importDonationItems: vi.fn(),
  updateDonationRound: vi.fn(),
}));
const viewer = vi.hoisted(() => ({ role: "user", type: "student" }));

vi.mock("~/features/donations/data/donations", () => data);
vi.mock("~/features/app-shell", () => ({
  useAppShell: () => ({ profile: { role: viewer.role, type: viewer.type } }),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

const { DonationsScreen } =
  await import("~/features/donations/components/donations-screen");

const openRound: DonationRound = {
  id: 1,
  title: "2026년 2학기",
  opens_at: "2026-10-01T00:00:00Z",
  closes_at: "2026-10-31T00:00:00Z",
  is_open: true,
};

function item(overrides: Partial<DonationItem>): DonationItem {
  return {
    id: 1,
    category: "국내반 교재",
    name: "수학 교재",
    detail: null,
    donor_name: null,
    is_claimed: false,
    is_mine: false,
    claimant_name: null,
    claimant_cohort: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe = vi.fn();
      disconnect = vi.fn();
    },
  );
  viewer.role = "user";
  viewer.type = "student";
  data.loadDonationRounds.mockResolvedValue([openRound]);
  data.loadDonationClaims.mockResolvedValue([]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("DonationsScreen for students", () => {
  it("shows only the closed message outside the application period", async () => {
    data.loadDonationRounds.mockResolvedValue([
      { ...openRound, is_open: false },
    ]);
    render(<DonationsScreen />);

    expect(await screen.findAllByText("신청 기간이 아닙니다")).toHaveLength(1);
    expect(data.loadDonationItems).not.toHaveBeenCalled();
  });

  it("shows my claim count and filters to my claims", async () => {
    data.loadDonationItems.mockResolvedValue([
      item({ id: 1, name: "수학 교재", is_claimed: true, is_mine: true }),
      item({ id: 2, name: "영어 교재" }),
      item({
        id: 3,
        name: "하복",
        is_claimed: true,
        claimant_name: "홍길동",
        claimant_cohort: 29,
      }),
    ]);
    const user = userEvent.setup();
    render(<DonationsScreen />);

    expect(await screen.findByText("29기 홍길동")).toBeInTheDocument();
    expect(screen.getByText(/내 신청/, { selector: "p" })).toHaveTextContent(
      "내 신청 1/50",
    );
    expect(data.loadDonationItems).toHaveBeenCalledWith(1, {
      includeClaimants: true,
    });

    await user.click(screen.getByRole("button", { name: "내 신청 1" }));
    const list = screen.getByRole("list");
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(within(list).getByText("수학 교재")).toBeInTheDocument();
  });

  it("marks a claim immediately and then follows the server list", async () => {
    data.loadDonationItems.mockResolvedValueOnce([item({ id: 2 })]);
    let resolveClaim: () => void = vi.fn();
    data.claimDonationItem.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveClaim = resolve;
      }),
    );
    data.loadDonationItems.mockResolvedValue([
      item({ id: 2, is_claimed: true, is_mine: true }),
    ]);
    const user = userEvent.setup();
    render(<DonationsScreen />);

    await user.click(
      await screen.findByRole("button", { name: "수학 교재 신청" }),
    );

    expect(
      screen.getByRole("button", { name: "수학 교재 신청 취소" }),
    ).toBeInTheDocument();
    resolveClaim();
    await waitFor(() =>
      expect(data.loadDonationItems).toHaveBeenCalledTimes(2),
    );
    expect(data.claimDonationItem).toHaveBeenCalledWith(2);
  });

  it("asks before cancelling a claim", async () => {
    data.loadDonationItems.mockResolvedValue([
      item({ id: 4, is_claimed: true, is_mine: true }),
    ]);
    data.cancelDonationClaim.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DonationsScreen />);

    await user.click(
      await screen.findByRole("button", { name: "수학 교재 신청 취소" }),
    );
    expect(data.cancelDonationClaim).not.toHaveBeenCalled();

    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "신청 취소" }));
    await waitFor(() =>
      expect(data.cancelDonationClaim).toHaveBeenCalledWith(4),
    );
  });

  it("disables new claims at the 50-item limit", async () => {
    data.loadDonationItems.mockResolvedValue([
      ...Array.from({ length: 50 }, (_, index) =>
        item({
          id: index + 10,
          name: `내 물품 ${index}`,
          is_claimed: true,
          is_mine: true,
        }),
      ),
      item({ id: 99, name: "남은 교재" }),
    ]);
    const user = userEvent.setup();
    render(<DonationsScreen />);

    await user.click(
      await screen.findByRole("button", { name: "신청 가능 1" }),
    );
    const button = await screen.findByRole("button", {
      name: "남은 교재 신청",
    });
    expect(button).toBeDisabled();
    expect(
      screen.getByText(/최대 50개까지 신청할 수 있습니다/),
    ).toBeInTheDocument();
  });
});

describe("DonationsScreen application eligibility", () => {
  it.each(["teacher", "alumni"])(
    "lets a %s browse without applying",
    async (type) => {
      viewer.type = type;
      data.loadDonationItems.mockResolvedValue([item({ id: 2 })]);
      render(<DonationsScreen />);

      expect(await screen.findByText("수학 교재")).toBeInTheDocument();
      expect(
        screen.getByText(/재학생만 신청할 수 있습니다/),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "수학 교재 신청" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByText(/내 신청/)).not.toBeInTheDocument();
    },
  );

  it("lets an administrator who is not a student apply", async () => {
    viewer.role = "admin";
    viewer.type = "alumni";
    data.loadDonationItems.mockResolvedValue([item({ id: 2 })]);
    data.claimDonationItem.mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(<DonationsScreen />);

    await user.click(
      await screen.findByRole("button", { name: "수학 교재 신청" }),
    );
    await waitFor(() => expect(data.claimDonationItem).toHaveBeenCalledWith(2));
  });
});

describe("DonationsScreen load errors", () => {
  it("clears a round error once a later refresh succeeds", async () => {
    const polls: (() => void)[] = [];
    vi.spyOn(window, "setInterval").mockImplementation(((
      handler: () => void,
    ) => {
      polls.push(handler);
      return 1;
    }) as unknown as typeof window.setInterval);
    data.loadDonationRounds
      .mockRejectedValueOnce(new Error("네트워크 오류"))
      .mockResolvedValue([openRound]);
    data.loadDonationItems.mockResolvedValue([item({ id: 2 })]);
    render(<DonationsScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("네트워크 오류");

    polls[0]();
    expect(await screen.findByText("수학 교재")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("retries a failed item load and clears its error", async () => {
    data.loadDonationItems
      .mockRejectedValueOnce(new Error("목록 오류"))
      .mockResolvedValue([item({ id: 2 })]);
    const user = userEvent.setup();
    render(<DonationsScreen />);

    expect(await screen.findByRole("alert")).toHaveTextContent("목록 오류");

    await user.click(screen.getByRole("button", { name: "다시 시도" }));
    expect(await screen.findByText("수학 교재")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("DonationsScreen for administrators", () => {
  it("shows applicants from the history without the claimant read", async () => {
    viewer.role = "admin";
    data.loadDonationItems.mockResolvedValue([
      item({ id: 5, is_claimed: true, donor_name: "김기증" }),
    ]);
    data.loadDonationClaims.mockResolvedValue([
      {
        item_id: 5,
        category: "국내반 교재",
        item_name: "수학 교재",
        detail: null,
        donor_name: "김기증",
        applicant: "학생",
        applicant_pub_id: "student",
        applicant_cohort: 30,
        applied_at: "2026-10-02T00:00:00Z",
        cancelled_at: null,
      },
    ]);
    render(<DonationsScreen />);

    expect(await screen.findByText("30기 학생")).toBeInTheDocument();
    expect(screen.getByText("기증자 김기증")).toBeInTheDocument();
    expect(data.loadDonationItems).toHaveBeenCalledWith(1, {
      includeClaimants: false,
    });
    expect(screen.queryByText("물품 엑셀 등록")).not.toBeInTheDocument();
  });
});
