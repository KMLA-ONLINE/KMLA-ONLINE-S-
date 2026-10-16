/**
 * 학교 게시판은 주소 해시의 `post_id`를 읽어 그 공지를 펼친다. 학교 사이트에 로그인되어 있지
 * 않으면 로그인 화면으로 넘어가고, 로그인 뒤에는 이 공지로 돌아오지 않는다.
 */
export function schoolNoticeUrl(postId: number): string {
  return `https://old.minjok.hs.kr/sub08_08.php#page=1&sfl=&kwd=&post_id=${postId}`;
}
