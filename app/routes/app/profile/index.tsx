import { Navigate } from "react-router";

import { defineAppChrome, useAppShell } from "~/features/app-shell";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function MyProfilePage() {
  const { profile } = useAppShell();

  return <Navigate to={`/profile/${profile.pub_id}`} replace />;
}
