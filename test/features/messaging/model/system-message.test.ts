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

  it("별명이 설정된 구성원의 이름은 시스템 메시지에 본명으로 쓴다", () => {
    const nicknamedPeople = new Map<string, MessageParticipant>([
      [
        "a",
        {
          id: "a",
          name: "길동이",
          profileName: "홍길동",
          avatarUrl: null,
          active: true,
        },
      ],
    ]);

    expect(
      formatSystemMessage(
        { kind: "member_left", profileIds: ["a"], name: null },
        nicknamedPeople,
      ),
    ).toBe("홍길동님이 나갔습니다.");
  });

  it("별명 변경과 해제 기록은 당시 이름을 사용한다", () => {
    const nicknameChange = {
      kind: "nickname_changed" as const,
      profileIds: ["a", "b"] as [string, string],
      name: "환경부/황보민",
      actorName: "식품영양부/문영원",
      targetName: "Min Hwangbo",
    };

    expect(formatSystemMessage(nicknameChange, people)).toBe(
      "식품영양부/문영원님이 Min Hwangbo님의 별명을 환경부/황보민으로 설정했습니다.",
    );
    expect(formatSystemMessage({ ...nicknameChange, name: null }, people)).toBe(
      "식품영양부/문영원님이 Min Hwangbo님의 별명을 원래 이름으로 되돌렸습니다.",
    );
    expect(
      formatSystemMessage(
        {
          ...nicknameChange,
          profileIds: ["a", "a"] as [string, string],
          actorName: "별명 전 문영원",
          targetName: "문영원",
        },
        people,
      ),
    ).toBe(
      "별명 전 문영원님이 문영원님의 별명을 환경부/황보민으로 설정했습니다.",
    );
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
