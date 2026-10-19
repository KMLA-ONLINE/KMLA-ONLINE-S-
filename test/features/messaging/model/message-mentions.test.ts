import { describe, expect, it } from "vitest";

import {
  addMessageMention,
  mentionProfileIdsOf,
  mentionPubIdsOf,
  mentionQueryAt,
  messageMentionEntries,
  messageMentionSuggestions,
  prepareMessageMentions,
  resolveMessageMention,
  typedMentionTrigger,
} from "~/features/messaging/model/message-mentions";
import type { MessageParticipant } from "~/features/messaging/model/types";
import { mentionDisplayText } from "~/features/posts/model/mentions";

const participants: MessageParticipant[] = [
  { id: "1", pubId: "me", name: "김한결", avatarUrl: null, active: true },
  { id: "2", pubId: "seo", name: "박서현", avatarUrl: null, active: true },
  { id: "3", pubId: "min", name: "최민준", avatarUrl: null, active: true },
  { id: "4", pubId: "left", name: "윤지우", avatarUrl: null, active: false },
  { id: "5", name: "공개 ID 없음", avatarUrl: null, active: true },
];

describe("message mentions", () => {
  it("후보는 모든 사람이 먼저이고, 나와 나간 멤버와 공개 ID를 모르는 사람은 뺀다", () => {
    expect(
      messageMentionSuggestions(participants, "1", "").map(({ name }) => name),
    ).toEqual(["모든 사람", "박서현", "최민준"]);
  });

  it("이어 친 글자로 대소문자와 공백을 무시하고 거른다", () => {
    const names = (query: string) =>
      messageMentionSuggestions(participants, "1", query).map(
        ({ name }) => name,
      );
    expect(names("민")).toEqual(["최민준"]);
    expect(names("모든사")).toEqual(["모든 사람"]);
    expect(names("없음")).toEqual([]);
  });

  it("캐럿 바로 앞에 친 @ 하나만 후보 목록을 연다", () => {
    expect(typedMentionTrigger("회의 ", "회의 @", 4)).toBe(3);
    // 글 가운데에서 쳐도 연다.
    expect(typedMentionTrigger("앞뒤", "앞@뒤", 2)).toBe(1);
    expect(typedMentionTrigger("", "@@", 2)).toBeNull();
    expect(typedMentionTrigger("a", "a@b", 2)).toBeNull();
    expect(typedMentionTrigger("ab", "a@", 2)).toBeNull();
  });

  it("@부터 캐럿까지가 검색어이고, 공백이나 캐럿이 앞으로 가면 닫는다", () => {
    expect(mentionQueryAt("회의 @서", 3, 5)).toBe("서");
    expect(mentionQueryAt("회의 @서 ", 3, 6)).toBeNull();
    expect(mentionQueryAt("회의 @서", 3, 3)).toBeNull();
    expect(mentionQueryAt("회의 서", 3, 4)).toBeNull();
  });

  it("고른 사람은 원문을 보고 번호를 받고, 모든 사람은 0번을 쓴다", () => {
    const [everyone, seo] = messageMentionSuggestions(participants, "1", "");
    const first = addMessageMention([], seo, "[@최민준](m:1) ");
    expect(first?.entry).toEqual({ ordinal: 2, pubId: "seo", name: "박서현" });

    const all = addMessageMention(first!.entries, everyone, "");
    expect(all?.entry).toEqual({ ordinal: 0, pubId: "", name: "모든 사람" });
    // 이미 있으면 다시 넣지 않는다.
    expect(addMessageMention(all!.entries, everyone, "")?.entries).toBe(
      all!.entries,
    );
  });

  it("보낼 원문은 남은 사람 토큰만 1부터 다시 매기고 모든 사람 토큰은 그대로 둔다", () => {
    const entries = [
      { ordinal: 2, pubId: "seo", name: "박서현" },
      { ordinal: 0, pubId: "", name: "모든 사람" },
    ];
    const text = `${mentionDisplayText("모든 사람", 0)} ${mentionDisplayText("박서현", 2)} 확인`;

    expect(prepareMessageMentions(text, entries)).toEqual({
      body: "[@모든 사람](m:0) [@박서현](m:1) 확인",
      mentionPubIds: ["seo"],
      entries: [
        { ordinal: 1, pubId: "seo", name: "박서현" },
        { ordinal: 0, pubId: "", name: "모든 사람" },
      ],
    });
  });

  it("고칠 메시지의 멘션을 지금 참여자 목록으로 초안에 올린다", () => {
    expect(
      messageMentionEntries(
        {
          body: "[@모든 사람](m:0) [@옛 이름](m:1) [@탈퇴](m:2)",
          mentionProfileIds: ["2", "9"],
        },
        participants,
      ),
    ).toEqual([
      { ordinal: 1, pubId: "seo", name: "박서현" },
      { ordinal: 0, pubId: "", name: "모든 사람" },
    ]);
  });

  it("공개 ID와 참여자 ID를 서로 바꾼다", () => {
    expect(mentionProfileIdsOf(["seo", "min"], participants)).toEqual([
      "2",
      "3",
    ]);
    expect(mentionPubIdsOf(["2", "3"], participants)).toEqual(["seo", "min"]);
  });

  it("보낸 멘션은 지금 이름으로 그리고, 대상을 모르면 null이다", () => {
    const byId = new Map(participants.map((person) => [person.id, person]));
    expect(resolveMessageMention(0, [], byId)).toEqual({ name: "모든 사람" });
    expect(resolveMessageMention(1, ["4"], byId)).toEqual({
      name: "윤지우",
      pubId: "left",
    });
    expect(resolveMessageMention(2, ["4"], byId)).toBeNull();
  });
});
