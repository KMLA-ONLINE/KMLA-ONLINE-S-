import type { ShellData } from "~/domains/shell/model/types";

/**
 * 스키마가 생기기 전까지 셸을 굴리기 위한 가짜 데이터. **나중에 통째로 지울 파일이다.**
 *
 * `data/queries.ts`의 `loadShellData()`만 이 파일을 읽는다. `profiles` 테이블과 RPC 3개
 * (`get_my_profile`, `get_unread_message_count`, `get_unread_notification_count`)가
 * 마이그레이션으로 들어오면 그 함수 본문만 바꾸고 이 파일을 지운다 — 라우트·컴포넌트는
 * 손대지 않는다.
 */
export const mockShellData: ShellData = {
  email: "student@kmla.hs.kr",
  profile: {
    id: "00000000-0000-0000-0000-000000000000",
    name: "홍길동",
    role: "student",
    status: "accepted",
    avatar_url: null,
  },
  badges: {
    "/messenger": 3,
    "/noti": 12,
  },
};
