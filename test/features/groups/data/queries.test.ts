import { beforeEach, describe, expect, it, vi } from "vitest";

const { createProfileMediaUrls, getSupabase } = vi.hoisted(() => ({
  createProfileMediaUrls: vi.fn(),
  getSupabase: vi.fn(),
}));

vi.mock("~/features/profiles/data/media", () => ({ createProfileMediaUrls }));
vi.mock("~/shared/supabase/client", () => ({ getSupabase }));

import {
  listGroupJoinRequests,
  listGroupMembers,
  loadGroupDetail,
} from "~/features/groups/data/queries";

/**
 * 명부와 가입 신청 목록은 `profiles.avatar_path`를 그대로 받는다. 서명하지 않으면 화면이
 * object path를 `<img src>`에 넣어 상대 경로 요청을 내보내고, 아바타가 전부 기본 실루엣이
 * 된다.
 */
describe("group roster avatars", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createProfileMediaUrls.mockResolvedValue(
      new Map([["profiles/avatar.webp", "https://signed.example/avatar"]]),
    );
  });

  it("signs member avatars without touching the raw path", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          membership_id: "membership-1",
          role: "member",
          joined_at: "2026-01-01T00:00:00Z",
          cohort: 30,
          is_returning_student: false,
          pub_id: "hanbyeol-25",
          name: "이한별",
          avatar_path: "profiles/avatar.webp",
        },
      ],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc });

    const page = await listGroupMembers("group-id");

    expect(page.members[0]).toMatchObject({
      avatar_path: "profiles/avatar.webp",
      avatar_url: "https://signed.example/avatar",
    });
  });

  it("leaves an unsigned join request avatar null", async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [
        {
          request_id: "request-1",
          requested_at: "2026-01-02T00:00:00Z",
          cohort: 31,
          is_returning_student: false,
          pub_id: "joiner",
          name: "김가입",
          avatar_path: "profiles/missing.webp",
        },
      ],
      error: null,
    });
    getSupabase.mockReturnValue({ rpc });

    const [request] = await listGroupJoinRequests("group-id");

    expect(request?.avatar_url).toBeNull();
  });
});

/** 비공개 승인 가입 그룹은 비멤버 RLS에 보이지 않아, 주소로 미리보기 RPC를 다시 묻는다(§7.5). */
describe("group detail link preview", () => {
  beforeEach(() => vi.clearAllMocks());

  it("falls back to the link preview when the group row is hidden", async () => {
    const emptyQuery = {
      select: () => emptyQuery,
      eq: () => emptyQuery,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        group_id: "group-id",
        slug: "8f2a1c4e6b9d7a",
        name: "필름 서클",
        description: "설명",
        join_policy: "request",
        identity_policy: "optional_anonymous",
        posting_policy: "members",
        member_count: 3,
        requested_at: "2026-01-02T00:00:00Z",
      },
      error: null,
    });
    const rpc = vi.fn().mockReturnValue({ maybeSingle });
    getSupabase.mockReturnValue({ from: () => emptyQuery, rpc });

    const group = await loadGroupDetail("8f2a1c4e6b9d7a");

    expect(rpc).toHaveBeenCalledWith("get_group_link_preview", {
      p_slug: "8f2a1c4e6b9d7a",
    });
    expect(group).toMatchObject({
      group_id: "group-id",
      kind: "unofficial",
      icon_path: null,
      cover_path: null,
      membership_state: "requested",
      member_role: null,
    });
  });

  it("never asks for a preview of a custom address", async () => {
    const emptyQuery = {
      select: () => emptyQuery,
      eq: () => emptyQuery,
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    };
    const rpc = vi.fn();
    getSupabase.mockReturnValue({ from: () => emptyQuery, rpc });

    await expect(loadGroupDetail("film-circle")).resolves.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
