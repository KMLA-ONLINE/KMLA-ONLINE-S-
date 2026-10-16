import { describe, expect, it } from "vitest";

import {
  schoolAttachmentUrl,
  schoolNoticeUrl,
} from "~/features/school-notices/model/school-notice-link";

describe("schoolNoticeUrl", () => {
  it("학교 공지 게시판에서 해당 공지를 바로 여는 주소를 만든다", () => {
    expect(schoolNoticeUrl(5865)).toBe(
      "https://old.minjok.hs.kr/sub08_08.php#page=1&sfl=&kwd=&post_id=5865",
    );
  });
});

describe("schoolAttachmentUrl", () => {
  it("학교 게시판의 첨부 다운로드 주소를 만든다", () => {
    expect(schoolAttachmentUrl(24105)).toBe(
      "https://old.minjok.hs.kr/lens/main.php?module=board&task=download&attachment_id=24105",
    );
  });
});
