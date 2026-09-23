import type { ReactNode } from "react";

/**
 * 도움말과 업데이트 기록이 쓰는 모델.
 *
 * 이 두 화면의 내용은 Supabase도 외부 CMS도 아니고 `../content/`의 파일이다. 런타임 서버가
 * 없는 앱이라 외부 CMS는 Edge Function 프록시를 하나 세워야 하고, 업데이트 기록은 애초에
 * 기능을 내보내는 그 커밋에서 같이 고쳐야 어긋나지 않는다.
 *
 * 나중에 내용을 DB로 옮기더라도 바뀌는 곳은 route 하나다 — 화면은 이 모델만 받는다.
 */

export interface FaqItem {
  /** 사용자가 실제로 던지는 문장 그대로 쓴다. 키워드 목록이 아니다. */
  question: string;
  /** 링크와 강조를 쓸 수 있게 JSX로 받는다. Markdown 파서를 끌어오지 않는다. */
  answer: ReactNode;
}

export interface FaqSection {
  /** React key이자 제목과 목록을 잇는 `aria-labelledby` 대상. */
  id: string;
  title: string;
  items: FaqItem[];
}

/**
 * 도움말 맨 아래 문의 영역. 링크로 보낼 곳이 있으면 `contacts`, 글로만 안내할 것은 `note`다.
 * 둘 다 비어 있으면 화면이 문의 영역을 그리지 않는다.
 */
export interface SupportContact {
  label: string;
  description?: string;
  /** 앱 안 경로면 `Link`, 그 밖이면 새 탭으로 연다. */
  to: string;
}

export type ReleaseChangeKind = "added" | "fixed" | "deleted";

export interface ReleaseChange {
  kind: ReleaseChangeKind;
  text: string;
}

export interface Release {
  /**
   * `YYYY-MM-DD`. 순간이 아니라 달력 날짜라서 문자열로 둔다. 사전순 정렬이 곧 시간순이다.
   */
  date: string;
  /** 배포에 번호를 붙이기 시작하면 채운다. 비어 있으면 화면은 날짜만 보여준다. */
  version?: string;
  title: string;
  changes: ReleaseChange[];
}
