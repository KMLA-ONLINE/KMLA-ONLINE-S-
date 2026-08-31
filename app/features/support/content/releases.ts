import type { Release } from "../model/types";

/**
 * 업데이트 기록(`/update`)에 실리는 내용. **이 파일이 그 화면의 편집 지점이다.**
 *
 * 새 항목은 맨 위에 붙인다. 순서가 어긋나도 화면이 날짜로 다시 정렬하지만, 파일을 읽는
 * 사람에게도 최신이 위에 있는 편이 낫다.
 *
 * 커밋 메시지를 옮겨 적는 곳이 아니다. 사용자가 화면에서 무엇이 달라졌는지 알아볼 수 있는
 * 문장만 남기고, 내부 리팩터링은 적지 않는다.
 *
 * https://itprogramming119.tistory.com/entry/IT-%EC%83%81%EC%8B%9D-%EB%B2%84%EC%A0%84-%ED%91%9C%EA%B8%B0%EB%B2%95-100
 */
export const releases: Release[] = [
  {
    date: "2026-08-31",
    version: "v0.1.0",
    title: "MVP",
    changes: [
      {
        kind: "added",
        text: "피드, 그룹, 게시물, 익명, 프로필, 알림, 잡다 유틸 기능 추가",
      },
    ],
  },
];
