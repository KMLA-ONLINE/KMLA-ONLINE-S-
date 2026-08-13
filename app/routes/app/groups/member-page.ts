import { listGroupMembers, type GroupMemberCursor } from "~/features/groups";
import type { GroupMemberRole } from "~/features/groups";
import type { Route } from "./+types/member-page";

const ROLES = new Set<GroupMemberRole>(["owner", "admin", "manager", "member"]);
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const searchParams = new URL(request.url).searchParams;
  const groupId = searchParams.get("groupId");
  if (!groupId) throw new Response("그룹을 찾을 수 없습니다.", { status: 400 });

  const role = searchParams.get("afterRole") as GroupMemberRole | null;
  const joinedAt = searchParams.get("afterJoinedAt");
  const membershipId = searchParams.get("afterId");
  const cursor: GroupMemberCursor | null =
    role &&
    ROLES.has(role) &&
    joinedAt &&
    ISO_TIMESTAMP.test(joinedAt) &&
    !Number.isNaN(Date.parse(joinedAt)) &&
    membershipId
      ? { role, joinedAt, membershipId }
      : null;
  if ((role || joinedAt || membershipId) && !cursor) {
    throw new Response("잘못된 멤버 페이지입니다.", { status: 400 });
  }

  return listGroupMembers(groupId, searchParams.get("q") ?? "", cursor);
}
