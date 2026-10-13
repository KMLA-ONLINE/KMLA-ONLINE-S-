import { describe, expect, it } from "vitest";

import {
  activeParticipants,
  formatSystemMessage,
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
    ).toBe("홍길동님이 대화 이름을 ‘축제 기획’(으)로 변경했습니다.");
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
