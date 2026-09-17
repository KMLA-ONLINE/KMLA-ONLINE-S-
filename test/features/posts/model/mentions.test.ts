import { describe, expect, it } from "vitest";

import { parseCommentText } from "~/features/posts/model/comment-text";
import {
  sanitizePostMarkdown,
  extractPostPlainText,
} from "~/features/posts/model/markdown";
import {
  MENTION_DISPLAY_MARK,
  MENTION_LIMIT,
  buildMentionToken,
  countMentionTargets,
  fromMentionDisplay,
  mentionDisplaySlot,
  mentionDisplayText,
  mentionOrdinalFromHref,
  mentionTokenPattern,
  normalizeMentions,
  parseMentions,
  mentionDisplayRanges,
  sanitizeMentionDisplay,
  sanitizeMentionLabel,
  toMentionDisplay,
  toMentionDraft,
  validateMentionCount,
  type MentionDraftEntry,
} from "~/features/posts/model/mentions";

const 한별: MentionDraftEntry = {
  ordinal: 1,
  pubId: "hanbyeol-25",
  name: "이한별",
};
const 새벽: MentionDraftEntry = {
  ordinal: 2,
  pubId: "saebyeok-24",
  name: "박새벽",
};

describe("mention token", () => {
  it("survives the markdown sanitizer that strips other schemes", () => {
    const body = `오늘은 ${buildMentionToken("이한별", 1)} 님이 맡습니다.`;

    expect(sanitizePostMarkdown(body)).toContain("(m:1)");
    // 멘션이 아닌 주소는 그대로 걸러진다.
    expect(sanitizePostMarkdown("[클릭](javascript:alert(1))")).not.toContain(
      "javascript:",
    );
  });

  it("keeps the mention inside bold and heading marks", () => {
    const body = `## ${buildMentionToken("이한별", 1)}\n\n**${buildMentionToken("박새벽", 2)}**`;
    const safe = sanitizePostMarkdown(body);

    expect(safe).toContain("(m:1)");
    expect(safe).toContain("(m:2)");
  });

  it("reads as the written name in plain-text summaries", () => {
    const body = `${buildMentionToken("이한별", 1)} 님 확인 바랍니다`;

    // 피드 요약과 검색 결과는 Markdown 문법이 아니라 평문을 보여준다.
    expect(extractPostPlainText(body)).toBe("@이한별 님 확인 바랍니다");
  });

  it("drops characters that would break the token grammar", () => {
    expect(sanitizeMentionLabel("홍]길[동\\")).toBe("홍길동");
    expect(buildMentionToken("홍]길동", 3)).toBe("[@홍길동](m:3)");
  });

  it("drops markdown characters that would nest the link label", () => {
    // 남겨 두면 링크의 안쪽이 문자열이 아니라 중첩 노드가 되고, 대상을 못 찾았을 때의 폴백
    // 라벨이 비어 `@`만 남는다.
    expect(sanitizeMentionLabel("*굵은*_이름_`코드`")).toBe("굵은이름코드");
  });

  it("uses one grammar for the whole client", () => {
    // 서버(`private.parse_mention_ordinals`)와 글자 그대로 같아야 한다. 한쪽만 알아보는 토큰이
    // 생기면 화면에 없는 멘션이 알림을 보내거나 저장이 통째로 막힌다.
    expect(mentionTokenPattern().source).toBe(
      String.raw`\[@([^\]\n]*)\]\(m:([0-9]{1,2})\)`,
    );
    // `g` 플래그는 `lastIndex`를 들고 다닌다. 매번 새 객체여야 호출 사이에 상태가 새지 않는다.
    expect(mentionTokenPattern()).not.toBe(mentionTokenPattern());
  });

  it("rejects a label whose text spans a newline, exactly as the server does", () => {
    expect("[@ab\ncd](m:1)".match(mentionTokenPattern())).toBeNull();
  });

  it("recognises only mention hrefs", () => {
    expect(mentionOrdinalFromHref("m:1")).toBe(1);
    expect(mentionOrdinalFromHref("m:10")).toBe(10);
    expect(mentionOrdinalFromHref("https://example.com")).toBeNull();
    expect(mentionOrdinalFromHref("m:0")).toBeNull();
  });
});

describe("normalizeMentions", () => {
  it("renumbers the tokens the body still holds", () => {
    // 편집기가 1·2를 줬지만 본문에는 2만 남았다. 서버는 ordinal 을 배열 첨자로 쓰므로 1부터
    // 다시 매겨야 한다.
    const result = normalizeMentions(`${buildMentionToken("박새벽", 2)} 님`, [
      한별,
      새벽,
    ]);

    expect(result.body).toBe("[@박새벽](m:1) 님");
    expect(result.pubIds).toEqual(["saebyeok-24"]);
  });

  it("gives one ordinal to a person named twice", () => {
    const body = `${buildMentionToken("이한별", 1)}와 ${buildMentionToken("이한별", 1)}`;
    const result = normalizeMentions(body, [한별]);

    expect(result.pubIds).toEqual(["hanbyeol-25"]);
    expect(countMentionTargets(body, [한별])).toBe(1);
  });

  it("keeps the order the tokens appear in", () => {
    const body = `${buildMentionToken("박새벽", 2)} ${buildMentionToken("이한별", 1)}`;
    const result = normalizeMentions(body, [한별, 새벽]);

    expect(result.body).toBe("[@박새벽](m:1) [@이한별](m:2)");
    expect(result.pubIds).toEqual(["saebyeok-24", "hanbyeol-25"]);
  });

  it("unwraps a token the editor never issued", () => {
    // 기존 원문이나 댓글 입력에는 사용자가 직접 친 토큰이 들어올 수 있다. 부를 사람을 지어내지
    // 않고 평문으로 남긴다 -- 서버도 짝 없는 ordinal 은 거절한다.
    const result = normalizeMentions("[@아무개](m:7) 님", []);

    expect(result.body).toBe("@아무개 님");
    expect(result.pubIds).toEqual([]);
  });
});

describe("validateMentionCount", () => {
  const many: MentionDraftEntry[] = Array.from(
    { length: MENTION_LIMIT + 1 },
    (_unused, index) => ({
      ordinal: index + 1,
      pubId: `member-${index}`,
      name: `멤버${index}`,
    }),
  );

  it("accepts a body at the limit", () => {
    const body = many
      .slice(0, MENTION_LIMIT)
      .map((entry) => buildMentionToken(entry.name, entry.ordinal))
      .join(" ");

    expect(countMentionTargets(body, many)).toBe(MENTION_LIMIT);
    expect(validateMentionCount(body, many)).toBeNull();
  });

  it("names the limit when the body goes past it", () => {
    // 기존 원문이나 댓글에는 버튼을 거치지 않은 토큰이 들어올 수 있다. 서버가 잡기 전에 입력창
    // 옆에서 알린다.
    const body = many
      .map((entry) => buildMentionToken(entry.name, entry.ordinal))
      .join(" ");

    expect(validateMentionCount(body, many)).toBe(
      "멘션은 50명까지 할 수 있습니다.",
    );
  });
});

describe("comment text", () => {
  it("splits mentions out of plain text", () => {
    const segments = parseCommentText(
      `${buildMentionToken("이한별", 1)} 님 https://example.com 보세요`,
    );

    expect(segments).toEqual([
      { type: "mention", ordinal: 1, label: "이한별" },
      { type: "text", value: " 님 " },
      { type: "link", value: "https://example.com" },
      { type: "text", value: " 보세요" },
    ]);
  });

  it("keeps line breaks around mentions", () => {
    const segments = parseCommentText(`앞\n${buildMentionToken("박새벽", 2)}`);

    expect(segments).toEqual([
      { type: "text", value: "앞" },
      { type: "break" },
      { type: "mention", ordinal: 2, label: "박새벽" },
    ]);
  });
});

describe("parseMentions", () => {
  it("narrows the json column and drops malformed rows", () => {
    expect(
      parseMentions([
        {
          ordinal: 1,
          pub_id: "hanbyeol-25",
          name: "이한별",
          avatar_path: null,
        },
        { ordinal: "x" },
        null,
      ]),
    ).toEqual([
      {
        ordinal: 1,
        pub_id: "hanbyeol-25",
        name: "이한별",
        avatar_path: null,
      },
    ]);
    expect(parseMentions(null)).toEqual([]);
  });

  it("leaves a withdrawn target out of the editing draft", () => {
    // 탈퇴한 사용자는 다시 부를 수 없다. 본문의 토큰은 남지만 제출할 때 평문으로 풀린다.
    expect(
      toMentionDraft([
        { ordinal: 1, pub_id: null, name: null, avatar_path: null },
        {
          ordinal: 2,
          pub_id: "saebyeok-24",
          name: "박새벽",
          avatar_path: null,
        },
      ]),
    ).toEqual([{ ordinal: 2, pubId: "saebyeok-24", name: "박새벽" }]);
  });
});

describe("mention display form", () => {
  it("unwraps tokens with the current name and wraps them back", () => {
    const body = `${buildMentionToken("옛 이름", 1)} 확인 부탁`;
    const display = toMentionDisplay(body, [한별]);

    // 토큰의 라벨은 장식이라 개명 전 이름일 수 있다. 짝은 ordinal로 찾는다.
    expect(display).toBe(`${mentionDisplayText("이한별")} 확인 부탁`);
    expect(display).toContain("@이한별");
    expect(fromMentionDisplay(display, [한별])).toBe(
      `${buildMentionToken("이한별", 1)} 확인 부탁`,
    );
  });

  it("leaves a name nobody picked as plain text", () => {
    expect(fromMentionDisplay("@아무개 안녕", [한별])).toBe("@아무개 안녕");
  });

  it("leaves a hand-typed name plain even when that person was picked", () => {
    // 버튼으로 불렀다가 지운 사람의 이름을 나중에 손으로 쳐도 다시 불리지 않는다. 초안은
    // 본문에서 토큰이 사라져도 그 사람을 계속 들고 있기 때문이다.
    expect(fromMentionDisplay("@이한별 선배가 그러던데", [한별])).toBe(
      "@이한별 선배가 그러던데",
    );
  });

  it("does not hand a withdrawn target's label to a namesake", () => {
    const body = `${buildMentionToken("이한별", 1)} 그리고 ${buildMentionToken("이한별", 3)} 님도`;
    const display = toMentionDisplay(body, [한별]);

    // ordinal 3은 탈퇴한 사용자라 초안에 없다. 라벨이 같다고 활성 대상 쪽으로 붙으면 부른 적
    // 없는 사람에게 알림이 간다.
    expect(fromMentionDisplay(display, [한별])).toBe(
      `${buildMentionToken("이한별", 1)} 그리고 @이한별 님도`,
    );
  });

  it("does not cut a longer name in half", () => {
    const 민: MentionDraftEntry = { ordinal: 1, pubId: "min", name: "김민" };
    const 민수: MentionDraftEntry = {
      ordinal: 2,
      pubId: "minsu",
      name: "김민수",
    };

    expect(
      fromMentionDisplay(`${mentionDisplayText("김민수")} 님`, [민, 민수]),
    ).toBe(`${buildMentionToken("김민수", 2)} 님`);
  });

  it("calls each namesake by the mark it carries", () => {
    const 한별둘: MentionDraftEntry = {
      ordinal: 2,
      pubId: "hanbyeol-26",
      name: "이한별",
    };
    const 먼저 = mentionDisplayText("이한별", 0);
    const 나중 = mentionDisplayText("이한별", 1);

    // 이름이 같아도 각자 자기 표시를 달고 있다. 화면에는 둘 다 `@이한별`로 보인다.
    expect(먼저).not.toBe(나중);
    expect(fromMentionDisplay(`${먼저} ${나중}`, [한별, 한별둘])).toBe(
      `${buildMentionToken("이한별", 1)} ${buildMentionToken("이한별", 2)}`,
    );

    // 넣은 순서를 바꿔도, 하나를 지워도 남은 쪽은 자기 사람을 부른다.
    expect(fromMentionDisplay(`${나중} ${먼저}`, [한별, 한별둘])).toBe(
      `${buildMentionToken("이한별", 2)} ${buildMentionToken("이한별", 1)}`,
    );
    expect(
      normalizeMentions(fromMentionDisplay(나중, [한별, 한별둘]), [
        한별,
        한별둘,
      ]).pubIds,
    ).toEqual(["hanbyeol-26"]);
  });

  it("folds namesakes past the last mark into one", () => {
    // 표시는 다섯 개뿐이다. 한 댓글에서 이름이 같은 사람을 그보다 많이 부르면 넘친 쪽은
    // 다섯 번째 사람으로 모인다.
    const group: MentionDraftEntry[] = Array.from(
      { length: 6 },
      (_unused, index) => ({
        ordinal: index + 1,
        pubId: `hanbyeol-${index}`,
        name: "이한별",
      }),
    );

    expect(mentionDisplayText("이한별", 5)).toBe(
      mentionDisplayText("이한별", 4),
    );
    expect(fromMentionDisplay(mentionDisplayText("이한별", 5), group)).toBe(
      buildMentionToken("이한별", 5),
    );
  });

  it("puts a new namesake at the end of the name", () => {
    const 한별둘 = { pub_id: "hanbyeol-26", name: "이한별" };

    expect(mentionDisplaySlot([한별], 한별둘)).toBe(1);
    // 이미 부른 사람은 제자리를 지킨다. 같은 사람을 다시 골라도 표시가 바뀌지 않는다.
    expect(
      mentionDisplaySlot([한별], { pub_id: "hanbyeol-25", name: "이한별" }),
    ).toBe(0);
    expect(
      mentionDisplaySlot([한별], { pub_id: "saebyeok-24", name: "박새벽" }),
    ).toBe(0);
  });

  it("does not wrap a token that is already in the text", () => {
    const body = `${buildMentionToken("이한별", 1)} ${mentionDisplayText("이한별")}`;

    expect(fromMentionDisplay(body, [한별])).toBe(
      `${buildMentionToken("이한별", 1)} ${buildMentionToken("이한별", 1)}`,
    );
  });

  it("marks off the span the input deletes as one piece", () => {
    const picked = mentionDisplayText("이한별");
    const ranges = mentionDisplayRanges(`앞 ${picked} 뒤`, [한별]);

    expect(ranges).toHaveLength(1);
    expect(ranges[0].start).toBe(2);
    expect(ranges[0].end).toBe(2 + picked.length);
    expect(ranges[0].entry).toEqual(한별);

    // 손으로 친 이름은 자리가 아니다. 지울 때도 한 글자씩 지워진다.
    expect(mentionDisplayRanges("@이한별", [한별])).toEqual([]);
  });

  it("strips a mark whose name no longer matches", () => {
    const broken = `${MENTION_DISPLAY_MARK}@이한벌`;
    const intact = mentionDisplayText("이한별");

    expect(sanitizeMentionDisplay(broken, [한별])).toBe("@이한벌");
    expect(sanitizeMentionDisplay(intact, [한별])).toBe(intact);
    expect(sanitizeMentionDisplay(`${intact} ${broken}`, [한별])).toBe(
      `${intact} @이한벌`,
    );
  });

  it("drops a mark that lost its name", () => {
    // 골라 넣은 뒤 이름을 고쳐 쓰면 표시만 남는다. 보이지 않는 글자를 저장하지 않는다.
    const orphan = `${MENTION_DISPLAY_MARK}@이한벌`;

    expect(fromMentionDisplay(orphan, [한별])).toBe("@이한벌");
    expect(fromMentionDisplay(orphan, [])).toBe("@이한벌");
  });
});
