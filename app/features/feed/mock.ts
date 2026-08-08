import type { FeedPost } from "~/features/feed/model/types";

/** 스키마가 생기기 전까지 피드를 굴리기 위한 가짜 데이터. **나중에 통째로 지울 파일이다.** */
export const mockFeedPosts: FeedPost[] = [
  {
    post_id: 3,
    title: "동아리 박람회 안내",
    content:
      "이번 주 금요일 6교시부터 대강당에서 동아리 박람회가 열립니다. 각 동아리 부스에서 활동 소개와 신입 부원 모집을 진행합니다.",
    author_name: "학생회",
    created_at: "2026-08-06T09:00:00.000Z",
  },
  {
    post_id: 2,
    title: "기숙사 소등 시간 변경",
    content:
      "다음 주부터 평일 소등이 23시 30분으로 조정됩니다. 시험 기간에는 별도 공지합니다.",
    author_name: "생활관",
    created_at: "2026-08-05T21:10:00.000Z",
  },
  {
    post_id: 1,
    title: "급식 메뉴 설문",
    content:
      "9월 급식 메뉴 선호도 조사를 받고 있습니다. 메뉴 탭에서 참여해 주세요.",
    author_name: "영양실",
    created_at: "2026-08-04T12:40:00.000Z",
  },
];
