-- 기능 명세 7.12 그룹 나가기를 데이터베이스에서 강제한다.
-- 비공식 그룹의 비소유자 멤버만 자신의 멤버십 행을 지울 수 있다. 공식 그룹 멤버십은
-- `private.sync_student_official_memberships()`가 소유하므로 직접 나갈 수 없고,
-- 소유자는 소유권을 이전하기 전까지 나갈 수 없다.
create policy "group_memberships_leave_own"
on public.group_memberships
for delete
to authenticated
using (
  profile_id = private.current_profile_id()
  and role <> 'owner'
  and exists (
    select 1
    from public.groups as group_record
    where group_record.id = group_memberships.group_id
      and group_record.kind = 'unofficial'
  )
);

grant delete on table public.group_memberships to authenticated;
