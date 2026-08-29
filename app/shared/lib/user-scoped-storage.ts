/**
 * 계정에 딸린 `localStorage` 값을 저장소의 주인이 바뀔 때 버린다.
 *
 * 브라우저 저장소에는 성격이 다른 두 가지가 섞여 있다. 하나는 기기 취향(카드/목록 보기,
 * 설치 안내, 실험 기능 토글)이라 누가 로그인하든 그대로 남아야 하고, 다른 하나는 그 계정의
 * 데이터라 계정이 바뀌면 남아 있으면 안 된다. 여기 모인 키는 후자뿐이다 —
 * `docs/DATA_CACHE_POLICY.md` §1이 말하는 "로그인 사용자 ID가 바뀌거나 로그아웃하면"의
 * `localStorage` 쪽 절반이고, 메모리 쪽 절반은 `QueryProvider`의 `queryClient.clear()`다.
 *
 * 로그아웃 시점에만 지우면 부족하다. 로그아웃하지 않고 탭만 닫은 뒤 같은 기기에서 다른
 * 사람이 로그인하는 경로가 그대로 남는다. 그래서 "언제 지울까"가 아니라 "지금 이 저장소의
 * 주인이 누구인가"를 적어 두고, 주인이 달라졌을 때 지운다.
 */

/** 시간표. DB의 `user_timetables`가 진짜 저장소이고 이 값은 첫 페인트를 채우는 캐시다. */
export const TIMETABLE_STORAGE_KEY = "kmla-online:timetable:v1";

/** 열어본 게시물 id. 목록에서 "이미 읽음"을 흐리게 그리는 데 쓴다. */
export const VISITED_POSTS_STORAGE_KEY = "kmla-online:visited-posts:v1";

/** 최근 검색. 검색한 사람과 그룹의 이름이 그대로 들어 있다. */
export const RECENT_SEARCH_STORAGE_KEY = "kmla-online:search-recent:v1";

const USER_SCOPED_KEYS = [
  TIMETABLE_STORAGE_KEY,
  VISITED_POSTS_STORAGE_KEY,
  RECENT_SEARCH_STORAGE_KEY,
];

/**
 * 지금 저장소에 남은 값이 누구 것인지 적어 두는 자리.
 *
 * 값은 Supabase auth user id다. 비밀이 아니다 — 로그인한 본인만 볼 수 있는 화면에서 이미
 * 쓰는 id이고, 여기서는 내용이 아니라 "달라졌는가"만 본다.
 */
const OWNER_KEY = "kmla-online:storage-owner:v1";

/**
 * 저장소의 주인을 `userId`에 맞춘다. 주인이 그대로면 아무것도 하지 않는다 — 새로고침마다
 * 캐시를 버리면 첫 페인트를 채우려고 둔 의미가 없어진다.
 *
 * `userId`가 `null`이면 로그아웃이다. 주인 표시까지 지워서 다음 로그인이 깨끗한 상태에서
 * 시작하게 한다.
 */
export function syncUserScopedStorage(userId: string | null): void {
  if (typeof window === "undefined") return;

  try {
    if (window.localStorage.getItem(OWNER_KEY) === userId) return;

    for (const key of USER_SCOPED_KEYS) {
      window.localStorage.removeItem(key);
      notifySameTab(key);
    }

    if (userId === null) {
      window.localStorage.removeItem(OWNER_KEY);
    } else {
      window.localStorage.setItem(OWNER_KEY, userId);
    }
  } catch {
    // 비공개 모드처럼 저장소를 쓸 수 없는 브라우저. 남은 값도 없으니 지울 것도 없다.
  }
}

/**
 * `storage` 이벤트는 값을 바꾼 탭에는 오지 않는다. 그런데 지우는 쪽도 읽는 쪽도 같은 탭이라,
 * 알리지 않으면 `useVisitedPosts`의 모듈 수준 snapshot 같은 캐시가 이전 사용자의 값을 들고
 * 그대로 남는다. 지운 키를 같은 모양의 합성 이벤트로 알려서, 이미 `storage`를 듣고 있는
 * 쪽이 별도 경로 없이 다시 읽게 한다.
 */
function notifySameTab(key: string): void {
  window.dispatchEvent(new StorageEvent("storage", { key, newValue: null }));
}
