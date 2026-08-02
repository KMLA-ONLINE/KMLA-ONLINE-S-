import { type RouteConfig, index, route } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("theme", "routes/theme.tsx"),
] satisfies RouteConfig;
