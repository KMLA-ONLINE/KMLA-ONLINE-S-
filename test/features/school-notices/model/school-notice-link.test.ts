import { describe, expect, it } from "vitest";

import { schoolNoticeUrl } from "~/features/school-notices/model/school-notice-link";

describe("schoolNoticeUrl", () => {
  it("학교 공지 게시판에서 해당 공지를 바로 여는 주소를 만든다", () => {
    expect(schoolNoticeUrl(5865)).toBe(
      "https://old.minjok.hs.kr/sub08_08.php#page=1&sfl=&kwd=&post_id=5865",
    );
  });
});
