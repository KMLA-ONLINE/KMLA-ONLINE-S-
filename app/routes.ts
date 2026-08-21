import {
  index,
  layout,
  route,
  type RouteConfig,
} from "@react-router/dev/routes";

export default [
  route("login", "routes/auth/login.tsx"),
  route("signup", "routes/auth/signup.tsx"),
  route("setup", "routes/auth/setup.tsx"),
  route("pending", "routes/auth/pending.tsx"),
  route("logout", "routes/auth/logout.tsx"),
  route("theme", "routes/theme.tsx"),
  layout("routes/app/gate.tsx", [
    layout("routes/app/layout.tsx", [
      index("routes/app/home.tsx"),
      route("profile", "routes/app/profile/index.tsx"),
      route("noti", "routes/app/notifications.tsx"),
      route("menu", "routes/app/menu/index.tsx"),
      route("menu/licenses", "routes/app/menu/licenses.tsx"),
      route("menu/meal", "routes/app/menu/meal.tsx"),
      route("menu/timetable", "routes/app/menu/timetable.tsx"),
      route("groups", "routes/app/groups/index.tsx"),
      route("groups/discover", "routes/app/groups/discover.tsx"),
      route("groups/member-page", "routes/app/groups/member-page.ts"),
      route("clubs", "routes/app/clubs/index.tsx"),
      route("invite/:token", "routes/app/invite.tsx"),
      route("profile/:pubId", "routes/app/profile/detail.tsx", [
        route("posts/new", "routes/app/profile/post-new.tsx"),
        route("posts/:postId", "routes/app/profile/post.tsx"),
        route("posts/:postId/edit", "routes/app/profile/post-edit.tsx"),
      ]),
      route("profile/:pubId/edit", "routes/app/profile/edit.tsx"),
      route("groups/create", "routes/app/groups/create.tsx"),
      route("groups/:slug", "routes/app/groups/detail.tsx", [
        route("posts/new", "routes/app/groups/post-new.tsx"),
        route("posts/:postId", "routes/app/groups/post.tsx"),
        route("posts/:postId/edit", "routes/app/groups/post-edit.tsx"),
      ]),
      route("clubs/:clubId", "routes/app/clubs/detail.tsx"),
      route("admin/approvals", "routes/app/admin/approvals.tsx"),
    ]),
    layout("routes/messenger/layout.tsx", [
      route("messenger", "routes/messenger/index.tsx", [
        route(":roomId", "routes/messenger/room.tsx"),
      ]),
    ]),
  ]),
  route("*", "routes/catch-all.tsx"),
] satisfies RouteConfig;
