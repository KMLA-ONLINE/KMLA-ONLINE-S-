import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

/**
 * 전체 URL 지도. 앱에 어떤 화면이 있는지 알고 싶으면 여기부터 본다.
 *
 * **레이아웃은 여기서 정해진다. 라우트 모듈의 `handle`로 정하지 않는다.**
 * 화면을 추가할 때 물어볼 건 하나다: "탭바가 보이나? 페이지가 스크롤하나?"
 *   - 탭 목적지         → document  (탭바 O · 페이지 스크롤)
 *   - 드릴인 / 폼       → focused   (탭바 X · 페이지 스크롤)
 *   - 앱형(자체 스크롤) → immersive (고정 높이 · 라우트가 스크롤 소유)
 *
 * 잘못 놓으면 눈에 보이고, 이 파일 하나를 읽으면 어느 화면이 어떤 껍데기인지 다 나온다.
 *
 * 피드를 제외한 화면은 아직 `StubPage` 자리표시자다 — 셸(레이아웃 배치·내비게이션·인증
 * 게이트)을 실제로 눌러 보려면 라우트가 존재해야 해서 먼저 깔았다. 도메인이 화면을 구현하면서
 * 하나씩 채운다.
 */
export default [
  // 인증 게이트 + 셸 데이터 + 데스크톱 크롬
  layout("./domains/shell/routes/shell.tsx", [
    // 탭바 있음 · 페이지 스크롤
    layout("./domains/shell/routes/document.tsx", [
      index("./domains/feed/routes/feed.tsx"),
      route("groups", "./domains/group/routes/index.tsx"),
      route("groups/discover", "./domains/group/routes/discover.tsx"),
      route("clubs", "./domains/club/routes/index.tsx"),
      route("noti", "./domains/noti/routes/noti.tsx"),
      route("menu", "./domains/menu/routes/menu.tsx"),
      route("menu/meal", "./domains/menu/routes/meal.tsx"),
      route("profile", "./domains/profile/routes/me.tsx"),
    ]),

    // 탭바 없음 · 페이지 스크롤 (드릴인 · 폼)
    layout("./domains/shell/routes/focused.tsx", [
      route("groups/create", "./domains/group/routes/create.tsx"),
      route("groups/:pubId", "./domains/group/routes/group.tsx", [
        route("posts/:postId", "./domains/group/routes/post.tsx"),
      ]),
      route("clubs/:clubId", "./domains/club/routes/club.tsx"),
      route("profile/:profileId", "./domains/profile/routes/profile.tsx"),
      route("admin/approvals", "./domains/admin/routes/approvals.tsx"),
    ]),

    // 고정 높이 · 라우트가 스크롤 소유
    layout("./domains/shell/routes/immersive.tsx", [
      route("messenger", "./domains/messenger/routes/messenger.tsx", [
        route(":roomId", "./domains/messenger/routes/room.tsx"),
      ]),
    ]),
  ]),

  // 셸 바깥: 크롬도 인증 게이트도 없는 화면들
  route("login", "./domains/auth/routes/login.tsx"),
  route("signup", "./domains/auth/routes/signup.tsx"),
  route("logout", "./domains/auth/routes/logout.tsx"),
  route("setup", "./domains/auth/routes/setup.tsx"),
  route("pending", "./domains/auth/routes/pending.tsx"),

  // 색상 토큰 미리보기. 디자인 작업용이라 셸 밖에 둔다.
  route("theme", "./domains/shell/routes/theme.tsx"),

  route("*", "./domains/shell/routes/not-found.tsx"),
] satisfies RouteConfig;
