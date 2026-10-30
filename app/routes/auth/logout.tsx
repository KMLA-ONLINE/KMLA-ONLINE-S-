import { redirect } from "react-router";

import { clearTabMemory } from "~/features/app-shell";
import { signOut } from "~/features/auth";

export async function clientAction() {
  await signOut();
  // 로그아웃은 앱 안 redirect라 모듈 메모리가 남는다. 다음 계정이 이전 계정의 대화방·그룹으로 가지 않게 지운다.
  clearTabMemory();
  throw redirect("/login");
}

export default function LogoutRoute() {
  return null;
}
