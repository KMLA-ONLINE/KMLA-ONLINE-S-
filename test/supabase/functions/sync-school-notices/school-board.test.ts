import { describe, expect, it } from "vitest";

import { parseNoticeList } from "../../../../supabase/functions/sync-school-notices/school-board";

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
