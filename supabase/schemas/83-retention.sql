-- Declarative schema source of truth. Edit this file first, then generate and manually review the migration.

-- 시간이 계기인 정리를 한곳에 모은다. 스토리·예약·공강 일정·피드 랭킹 이벤트는 도메인이 다르지만
-- 계기가 모두 "기간 경과"로 같다. 넷을 따로 만들면 함수 넷과 예약 작업 넷이 되고 관리자 화면에서
-- 확인할 지점도 넷이 된다(삭제 및 보존 정책 §3 원칙 6, §6.1).
--
-- 사용자 행동이 계기인 삭제는 여기에 오지 않는다. 그쪽은 그 자리에서 지운다.

create or replace function private.cleanup_expired_records()
returns bigint
language plpgsql security definer
set search_path = ''
as $$
declare
  removed bigint := 0;
  affected bigint;
  korea_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  -- 스토리는 당일분만 조회한다(기능 명세 §17.6). 하루가 지나면 읽는 경로가 없지만, 시간대 경계에서
  -- 잘리지 않도록 이틀을 준다.
  delete from public.stories
  where created_at < ((korea_today - 1)::timestamp at time zone 'Asia/Seoul');
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 예약은 끝난 뒤 2주까지 남긴다. 반복 예약은 종료일이 정해지기 전까지 지우지 않는다.
  delete from public.utility_reservations as reservation
  where case
      when reservation.recurring then reservation.recurring_until
      else reservation.reservation_date
    end < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  delete from public.gongang_schedule
  where schedule_date < korea_today - 14;
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- 랭킹 이벤트는 append-only 라 정리 경로임을 밝혀야 지울 수 있다(삭제 및 보존 정책 §7.4).
  perform pg_catalog.set_config('app.feed_event_purge', 'on', true);

  -- 반응 이벤트는 발행 후 6시간 이내 게시물에만 합산된다. 그보다 오래된 것은 어떤 조회에도 잡히지
  -- 않는다. 경계를 넉넉히 두려고 하루를 남긴다.
  delete from private.post_reaction_count_events
  where occurred_at < now() - interval '24 hours';
  get diagnostics affected = row_count;
  removed := removed + affected;

  -- `#업` 이벤트는 게시물당 가장 최근 하나만 읽는다. 1시간 중복 방지 검사도 최근 구간만 보므로
  -- 최신 한 건을 남기면 두 조회가 모두 그대로 동작한다. 나머지는 죽은 데이터다.
  delete from private.feed_bump_events as bump
  where exists (
    select 1
    from private.feed_bump_events as newer
    where newer.post_id = bump.post_id
      and (newer.effective_at, newer.id) > (bump.effective_at, bump.id)
  );
  get diagnostics affected = row_count;
  removed := removed + affected;

  perform pg_catalog.set_config('app.feed_event_purge', 'off', true);

  return removed;
end;
$$;
alter function private.cleanup_expired_records() owner to postgres;

revoke all on function private.cleanup_expired_records() from public;
