import { describe, expect, it } from "vitest";

import {
  activeParticipants,
  formatSystemMessage,
  isDirectCounterpartWithdrawn,
  isViewerActive,
} from "~/features/messaging/model/system-message";
import type { MessageParticipant } from "~/features/messaging/model/types";

const people = new Map<string, MessageParticipant>(
  [
    { id: "a", name: "홍길동", avatarUrl: null, active: true },
    { id: "b", name: "김민준", avatarUrl: null, active: true },
    { id: "c", name: "박새벽", avatarUrl: null, active: false },
  ].map((person) => [person.id, person]),
);

describe("formatSystemMessage", () => {
  it("별명 변경은 별명이 아니라 프로필 이름으로 쓴다", () => {
    const nicknamed = new Map(people);
    nicknamed.set("b", {
      id: "b",
      name: "준이",
      profileName: "김민준",
      nickname: "준이",
      avatarUrl: null,
      active: true,
    });
    expect(
      formatSystemMessage(
        { kind: "nickname_set", profileIds: ["a", "b"], name: "준이" },
        nicknamed,
      ),
    ).toBe("홍길동님이 김민준님의 별명을 ‘준이’(으)로 정했습니다.");
    expect(
      formatSystemMessage(
        { kind: "nickname_set", profileIds: ["b", "b"], name: "민준이형" },
        nicknamed,
      ),
    ).toBe("김민준님이 자신의 별명을 ‘민준이형’(으)로 정했습니다.");
    expect(
      formatSystemMessage(
        { kind: "nickname_cleared", profileIds: ["a", "b"], name: null },
        nicknamed,
      ),
    ).toBe("홍길동님이 김민준님의 별명을 지웠습니다.");
    // 다른 시스템 메시지는 이 대화에서 보이는 이름을 쓴다.
    expect(
      formatSystemMessage(
        { kind: "member_left", profileIds: ["b"], name: null },
        nicknamed,
      ),
    ).toBe("준이님이 나갔습니다.");
  });

  it("초대, 나가기, 내보내기, 이름 변경을 문장으로 만든다", () => {
    expect(
      formatSystemMessage(
        { kind: "member_added", profileIds: ["a", "b", "c"], name: null },
        people,
      ),
    ).toBe("홍길동님이 김민준님, 박새벽님을 초대했습니다.");
    expect(
      formatSystemMessage(
        { kind: "member_left", profileIds: ["b"], name: null },
        people,
      ),
    ).toBe("김민준님이 나갔습니다.");
    expect(
      formatSystemMessage(
        { kind: "member_removed", profileIds: ["a", "c"], name: null },
        people,
      ),
    ).toBe("홍길동님이 박새벽님을 내보냈습니다.");
    expect(
      formatSystemMessage(
        { kind: "renamed", profileIds: ["a"], name: "축제 기획" },
        people,
      ),
    ).toBe("홍길동님이 채팅 이름을 ‘축제 기획’(으)로 변경했습니다.");
  });

  it("모르는 사람은 알 수 없는 사용자로 쓴다", () => {
    expect(
      formatSystemMessage(
        { kind: "member_left", profileIds: ["gone"], name: null },
        people,
      ),
    ).toBe("알 수 없는 사용자님이 나갔습니다.");
  });
});

describe("participants", () => {
  it("지금 멤버만 세고, 내가 나갔는지 안다", () => {
    const conversation = { participants: [...people.values()], viewerId: "c" };

    expect(activeParticipants(conversation).map(({ id }) => id)).toEqual([
      "a",
      "b",
    ]);
    expect(isViewerActive(conversation)).toBe(false);
    expect(isViewerActive({ ...conversation, viewerId: "a" })).toBe(true);
  });
});

describe("isDirectCounterpartWithdrawn", () => {
  const me = { id: "a", name: "홍길동", avatarUrl: null, active: true };
  const gone = {
    id: "b",
    name: "탈퇴한 사용자",
    avatarUrl: null,
    active: true,
    withdrawn: true,
  };

  it("1:1 대화 상대가 탈퇴했으면 참이다", () => {
    expect(
      isDirectCounterpartWithdrawn({
        type: "direct",
        viewerId: "a",
        participants: [me, gone],
      }),
    ).toBe(true);
  });

  it("상대가 남아 있거나 그룹 대화면 거짓이다", () => {
    expect(
      isDirectCounterpartWithdrawn({
        type: "direct",
        viewerId: "a",
        participants: [me, { ...gone, withdrawn: false }],
      }),
    ).toBe(false);
    expect(
      isDirectCounterpartWithdrawn({
        type: "group",
        viewerId: "a",
        participants: [me, gone],
      }),
    ).toBe(false);
  });
});
