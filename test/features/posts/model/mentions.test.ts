import { describe, expect, it } from "vitest";

import { parseCommentText } from "~/features/posts/model/comment-text";
import {
  sanitizePostMarkdown,
  extractPostPlainText,
} from "~/features/posts/model/markdown";
import {
  buildMentionToken,
  countMentionTargets,
  mentionOrdinalFromHref,
  normalizeMentions,
  parseMentions,
  sanitizeMentionLabel,
  toMentionDraft,
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
    // 모바일은 Markdown 원문을 그대로 편집하므로 사용자가 토큰을 직접 칠 수 있다. 부를 사람을
    // 지어내지 않고 평문으로 남긴다 -- 서버도 짝 없는 ordinal 은 거절한다.
    const result = normalizeMentions("[@아무개](m:7) 님", []);

    expect(result.body).toBe("@아무개 님");
    expect(result.pubIds).toEqual([]);
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
