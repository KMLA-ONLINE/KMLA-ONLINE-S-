import { redirect } from "react-router";

import { signOut } from "~/features/auth";

export async function clientAction() {
  await signOut();
  throw redirect("/login");
}

export default function LogoutRoute() {
  return null;
}
