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
