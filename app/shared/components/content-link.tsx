import type { ComponentPropsWithoutRef } from "react";
import { Link } from "react-router";

import { inAppPath } from "~/shared/lib/in-app-link";

/**
 * 게시물·댓글·메시지·스토리에 사용자가 넣은 링크. 앱 안 주소는 같은 탭에서 라우터로 이동하고, 그 밖은
 * 새 탭으로 연다. 앱 안 주소를 새 탭으로 열면 앱을 다시 띄우는 데다 그 탭에 기록이 없어 뒤로가기가 보던
 * 화면으로 돌아오지 못한다.
 */
export function ContentLink({
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  const path = href ? inAppPath(href, window.location.origin) : null;

  if (path !== null) {
    return (
      <Link {...props} to={path}>
        {children}
      </Link>
    );
  }
  return (
    <a {...props} href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  );
}
