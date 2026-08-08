/**
 * 셸 도메인의 public API. 다른 도메인은 이 파일로만 import 한다.
 *
 * 내보내는 게 적은 게 정상이다 — 셸의 나머지(레이아웃, 헤더, 사이드바, 탭바)는 `routes.ts`가
 * 직접 배치하므로 페이지가 부를 일이 없다.
 */
export { PageHeader } from "~/domains/shell/components/page-header";
export { useNavBadges, useShellData } from "~/domains/shell/model/shell-data";
export type {
  ProfileRole,
  ProfileStatus,
  ShellData,
  ShellProfile,
} from "~/domains/shell/model/types";
