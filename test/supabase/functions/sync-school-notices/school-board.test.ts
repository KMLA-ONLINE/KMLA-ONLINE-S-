import { describe, expect, it } from "vitest";

import {
  parseNoticeDetail,
  parseNoticeList,
} from "../../../../supabase/functions/sync-school-notices/school-board";

// 학교 게시판 목록 응답의 행 모양을 본뜬 가짜 HTML. 고정 공지는 번호 칸이 비어 있고 배경색이 붙는다.
function row({
  id,
  no,
  category,
  title,
  author,
  date,
  views,
  icons = "",
}: {
  id: number;
  no: string;
  category: string;
  title: string;
  author: string;
  date: string;
  views: string;
  icons?: string;
}) {
  const pinned = no === "" ? " style='background-color:#cceeee;'" : "";
  const click = "onclick='board_toggleIview(this);'";
  return (
    `<tr class='board_board' onmouseover='preview(${id});'${pinned}>` +
    `<td><input type='checkbox' class='board_check_board' value='${id}' user_id='1' /></td>` +
    `<td ${click}>${no}</td>` +
    `<td style='text-align:left;padding-left:10px;'  ${click}>${category}</td>` +
    `<td ${click}><div align=left><a href='javascript:readPost(${id});'>${title} ${icons}</a></div></td>` +
    `<td ${click}><strong>${author}</strong></td>` +
    `<td ${click}>${date}</td>` +
    `<td ${click}>${views}</td></tr>` +
    `<tr class='board_iview_board' content_id='${id}' style='display:none;'></tr>`
  );
}

const header =
  "<table><tr><th width='5%'><input type='checkbox' id='board_checkall_board' /></th><th>번호</th><th>분류</th><th>제목</th><th>이름</th><th>날짜</th><th>조회</th></tr>";

describe("parseNoticeList", () => {
  it("고정 공지를 빼고 일반 공지만 순서대로 읽는다", () => {
    const html =
      header +
      row({
        id: 900,
        no: "",
        category: "행정",
        title: "고정 공지",
        author: "가",
        date: "2026/06/19",
        views: "310",
      }) +
      row({
        id: 5865,
        no: "1608",
        category: "교무",
        title: "1학년 비전트립 대강 안내",
        author: "나",
        date: "2026/10/14",
        views: "247",
        icons:
          "<img src='/images/icon_save.gif' align='absmiddle' border='0' /> <img src='/images/icon_new.gif' align='absmiddle' border='0' />",
      }) +
      row({
        id: 5863,
        no: "1606",
        category: "교무",
        title: "국회 입법박람회 &amp; 참가 안내",
        author: "다",
        date: "2026/10/12",
        views: "88",
      }) +
      "</table>";

    expect(parseNoticeList(html)).toEqual([
      {
        postId: 5865,
        category: "교무",
        title: "1학년 비전트립 대강 안내",
        author: "나",
        postedOn: "2026-10-14",
        hasAttachment: true,
      },
      {
        postId: 5863,
        category: "교무",
        title: "국회 입법박람회 & 참가 안내",
        author: "다",
        postedOn: "2026-10-12",
        hasAttachment: false,
      },
    ]);
  });

  it("로그인이 풀린 응답처럼 행이 없으면 빈 배열이다", () => {
    expect(parseNoticeList(header + "</table>")).toEqual([]);
  });
});

// 학교 상세 응답(`task=read`)을 본뜬 값. JSON이 아니라 작은따옴표 객체 리터럴이고 학교 화면은 이를
// eval로 읽는다.
function detail({
  useHtml = 0,
  original,
  content,
  attachment = "[]",
}: {
  /** 숫자 또는 따옴표까지 포함한 리터럴 문자열(`"'1'"`) */
  useHtml?: number | string;
  original: string;
  content: string;
  attachment?: string;
}) {
  return (
    `{ 'username' : '<strong>가</strong>','user_id' : 6,'date' : '2026-10-14','time' : '08:07:09',` +
    `'use_html' : ${useHtml},'announcement' : 0,'category_id' : 24,'category_name' : '교무',` +
    `'title' : '대강 안내','content_original' : '${original}','content' : '${content}',` +
    `'attachment' : ${attachment}}`
  );
}

describe("parseNoticeDetail", () => {
  it("일반 글은 원문 텍스트를 본문으로 쓰고 첨부 목록을 읽는다", () => {
    const raw = detail({
      original: "1. 대상: \\'1학년\\'\\n2. 시간: 3교시",
      content: "1. 대상: &#039;1학년&#039;<br />2. 시간: 3교시",
      attachment:
        "[{ 'name' : '대강 시간표.pdf', 'size' : 65365, 'attachment_id' : 24105},{ 'name' : '안내문.hwpx', 'size' : 93967, 'attachment_id' : 23836}]",
    });

    expect(parseNoticeDetail(raw)).toEqual({
      body: "1. 대상: '1학년'\n2. 시간: 3교시",
      attachments: [
        { attachmentId: 24105, name: "대강 시간표.pdf", size: 65365 },
        { attachmentId: 23836, name: "안내문.hwpx", size: 93967 },
      ],
    });
  });

  it("HTML 글은 태그를 걷어 낸 텍스트만 본문으로 남긴다", () => {
    const raw = detail({
      useHtml: 1,
      original: "<p>원문</p>",
      content:
        "<p>준비물 &amp; 일정</p><div>[[0]]<script>alert(1)</script></div>장소:&nbsp;강당<br />끝",
      attachment: "[{ 'name' : '사진.jpg', 'size' : 10, 'attachment_id' : 7}]",
    });

    expect(parseNoticeDetail(raw)?.body).toBe(
      "준비물 & 일정\n\n장소: 강당\n끝",
    );
  });

  it("일반 글에 남은 첨부 이미지 자리 표시도 지운다", () => {
    const raw = detail({
      original: "포스터는 아래와 같습니다.\\n[[0]]\\n많은 참여 바랍니다.",
      content: "포스터는 아래와 같습니다.<br />[[0]]<br />많은 참여 바랍니다.",
    });

    expect(parseNoticeDetail(raw)?.body).toBe(
      "포스터는 아래와 같습니다.\n\n많은 참여 바랍니다.",
    );
  });

  it("use_html이 문자열로 와도 HTML 글로 다룬다", () => {
    const raw = detail({
      useHtml: "'1'",
      original: "<b>원문</b>",
      content: "<b>굵게</b> 쓴 글",
    });

    expect(parseNoticeDetail(raw)?.body).toBe("굵게 쓴 글");
  });

  it("자바스크립트 문자열 이스케이프를 글자로 되돌린다", () => {
    const raw = detail({
      original: "\\uD55C\\uAE00 \\x41\\tB",
      content: "",
    });

    expect(parseNoticeDetail(raw)?.body).toBe("한글 A\tB");
  });

  it("범위를 벗어나거나 이름이 아닌 엔티티는 글자로 바꾸지 않는다", () => {
    const raw = detail({
      useHtml: 1,
      original: "",
      content: "가&#0;나&#99999999;다&#xD800;라 &constructor; &toString; &#65;",
    });

    expect(parseNoticeDetail(raw)?.body).toBe(
      "가나다라 &constructor; &toString; A",
    );
  });

  it("상세 응답 모양이 아니면 null이다", () => {
    expect(parseNoticeDetail("<script>location='/members/'</script>")).toBe(
      null,
    );
  });
});
