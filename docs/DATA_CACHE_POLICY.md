# 클라이언트 데이터 캐시 정책

이 문서는 KMLA Online의 Supabase 조회 캐시와 무효화 규칙을 한곳에서 관리한다. 데이터베이스와 RLS가 항상 최종 데이터 및 권한의 기준이며, 클라이언트 캐시는 응답 속도를 개선하기 위한 수단일 뿐 권한 검사 수단이 아니다.

## 1. 기본 원칙

- 서버 조회 캐시는 TanStack Query의 브라우저 메모리 캐시만 사용한다.
- 보호된 조회 결과와 signed URL을 `localStorage`, IndexedDB 또는 Service Worker Cache Storage에
  저장하지 않는다.
- 로그인 사용자 ID가 바뀌거나 로그아웃하면 진행 중인 보호 조회가 더 이상 재사용되지 않도록 전체
  QueryClient를 비운다.
- 쿼리 키는 기능별 팩토리에서 정의한다. 컴포넌트와 라우트에 임의 배열 키를 흩어 놓지 않는다.
- mutation은 성공한 데이터가 어떤 목록과 상세에 영향을 주는지 명시적으로 무효화한다.
- 수동 새로고침은 현재 화면 재검증 전에 관련 캐시를 stale 상태로 만든다. 캐시가 새로고침 요청을
  가로막아서는 안 된다.
- 에러 응답, 권한 거부, 초대 및 관리자 데이터는 장기 캐시하지 않는다.

## 2. 키 구조

키의 첫 항목은 기능 영역, 다음 항목은 조회 종류다. 검색어는 trim 등 해당 기능의 정규화를 거친
값을 사용하고, 페이지 토큰과 커서는 다른 페이지와 충돌하지 않게 키에 포함한다.

```text
["feed", "list"]
["groups", "home"]
["groups", "discovery", query, includeJoined, cursor]
["groups", "detail", slug]
["groups", "categories", groupId]
["groups", "posts", groupId, { categoryId, cursor }]
["groups", "members", groupId, query]
["groups", "join-requests", groupId]
["groups", "invite", groupId]
["groups", "reports", groupId, sort]
["notifications", "page", beforeLastActivityAt, beforeId]
["notifications", "preferences"]
["signed-url", bucket, userId, objectPath]
```

기능 루트 키인 `["feed"]`, `["groups"]`는 하위 데이터를 한꺼번에 stale 처리해야 할 때만 사용한다.
일반 mutation은 가능한 한 좁은 키를 무효화한다.

## 3. 신선도와 보관 시간

| 데이터                     | staleTime | 이유                                                                 |
| -------------------------- | --------: | -------------------------------------------------------------------- |
| 피드 세션                  |      15초 | 로더·화면이 같은 tick에 중복 요청하지 않게만 막는다. 아래 설명 참고. |
| 그룹 홈·탐색·기본 상세     |      30초 | 탐색 이동의 중복 요청을 줄이고 membership 변경 시 즉시 무효화한다.   |
| 그룹 게시물·카테고리       |      15초 | 작성·수정·고정 mutation 후 즉시 무효화한다.                          |
| 멤버·가입 요청·신고·초대   |       0초 | 권한과 운영 상태 변화에 민감하다.                                    |
| 관리자·예약 등 미도입 영역 |       0초 | 별도 검토 전에는 기존 fresh-on-load 동작을 유지한다.                 |
| 알림함·알림 설정           |       0초 | Realtime과 focus 복귀 시 라우트를 즉시 재검증한다.                   |

사용되지 않는 캐시의 기본 `gcTime`은 10분이다. 브라우저를 새로 열면 모든 쿼리 캐시는 비어 있다.
Supabase가 피드 첫 페이지 요청을 5초 동안 중복 방지하는 규칙은 이 정책과 별개로 유지된다.

Storage signed URL도 같은 쿼리 캐시에 산다. 키는 `["signed-url", bucket, userId, objectPath]`이고
`staleTime`과 `gcTime`은 모두 55분이다. 60분짜리 URL을 발급하고 만료 5분 전까지만 재사용한다는
뜻이며, 기본 `gcTime`(10분)을 그대로 두면 화면을 잠깐 벗어난 사이 아직 45분 남은 URL을 버리게
되므로 반드시 함께 늘린다.

캐시가 하나로 합쳐지면서 사용자 전환 시 `queryClient.clear()`가 signed URL까지 함께 버린다.
키에 `userId`를 남겨 두는 것은 그 auth 이벤트가 도착하기 전 구간에 대한 이중 방어다.

같은 tick에 요청된 경로는 버킷별로 모아 `createSignedUrls` 한 번으로 서명한다. 서명에 실패한
경로는 결과 Map에서 빠지고 캐시에도 남지 않으므로 다음 호출에서 다시 시도한다. 게시물 목록
보기는 이미지와 파일을 렌더링하지 않으므로 signed URL을 미리 발급하지 않고, 카드 보기로 바꾸거나
상세를 열 때 현재 페이지의 경로를 서명한다.

## 4. 무효화 규칙

### 피드

피드는 페이지가 아니라 **세션** 단위로 캐시한다. `list_feed_posts`가 첫 페이지에서
`feedEpoch`를 발급하고 이후 페이지 토큰을 거기에 묶으므로, 페이지마다 키를 나누면 1페이지를
다시 읽는 순간 나머지 토큰이 죽는다. `["feed", "list"]` 하나에 무한 쿼리로 담는다.

그래서 피드에는 `invalidateQueries`를 쓰지 않는다. 무한 쿼리의 무효화는 "쌓인 페이지를 전부
다시 읽어라"가 되는데, 원하는 건 언제나 "새 세션의 1페이지"다. 대신 `resetFeed(queryClient)`
(= `resetQueries`)를 쓴다.

같은 이유로 시간 기반 자동 갱신을 끈다(`refetchOnMount: false`). 라우트 로더는
`ensureInfiniteQueryData`로 캐시가 있으면 그대로 쓰므로, 뒤로 가기로 돌아오면 쌓아 둔 페이지가
스크롤과 함께 살아 있다. 피드가 새로 열리는 시점은 아래 목록뿐이다.

새 세션은 싸지 않다. `private.create_feed_session()`은 후보를 전부 랭킹한 뒤
`feed_session_posts`에 행 단위 루프로 물리화하고, 그 사이 사용자별 advisory lock을 잡는다.
서버가 막아 주는 건 5초 내 재요청 합치기와 사용자당 세션 7개 상한뿐이다. 그러니 "게시물이
바뀌었다"를 뭉뚱그려 리셋에 걸지 않는다. 세션을 새로 여는 경우는 아래가 전부다.

- 당겨서 새로고침: 사용자가 직접 요청한 경우다.
- 그룹·프로필 게시물 생성과 수정: 새 글이 랭킹에 들어가야 한다.
- 그룹 가입·탈퇴·초대 수락: 볼 수 있는 범위 자체가 바뀐다.

나머지는 세션을 건드리지 않는다.

- 게시물 삭제: `removeFeedPost`로 캐시에서 그 글만 덜어낸다. 랭킹은 그대로 두므로 요청이 없다.
- 게시물 고정, 신고 처리, 카테고리 생성·이름 변경·순서 이동·삭제: 그룹 안의 상태만 바꾼다.
  해당 그룹의 게시물 목록과 상세만 무효화한다.
- 댓글과 반응: 현재 UI에는 canonical mutation 결과를 병합한다. 목록 전체는 랭킹 반영이 필요한 다음
  접근 또는 수동 새로고침 때 갱신한다.

### 그룹

- 가입, 가입 요청, 요청 취소, 탈퇴: 그룹 홈, 탐색, 해당 상세와 멤버 관련 키를 무효화한다.
- 그룹 고정: 그룹 홈과 해당 상세를 무효화한다.
- 설정·이미지·역할·소유권 변경: 해당 상세, 그룹 홈, 탐색 및 멤버 관련 키를 무효화한다.
- 게시물·카테고리 변경: 해당 그룹의 게시물·카테고리·상세만 무효화한다. 피드는 위 규칙을 따른다.
- 그룹 삭제 또는 접근 상실: 해당 그룹의 상세·게시물·멤버·신고 데이터를 즉시 제거하고 그룹 홈과 탐색을 무효화한다.

### 알림

- 첫 페이지와 설정은 route loader snapshot을 사용하며 보호된 알림 데이터를 영속 저장하지 않는다.
- 이전 페이지는 `(last_activity_at, id)` 커서로 현재 알림함 화면에만 병합하고 화면을 벗어나면 폐기한다.
- 개별·전체 읽음 처리, 알림 Realtime 변경과 창 focus 복귀는 알림함과 셸의 최근 24시간 badge를 함께 재검증한다.
- Web Push 구독 정보는 브라우저 Push API와 서버 RPC에서 확인하며 endpoint와 key를 클라이언트 캐시에
  저장하지 않는다. 권한 안내를 처리했는지 여부만 기기·계정별 versioned localStorage key로 저장한다.

## 5. 라우터와의 역할 분리

- React Router는 URL, redirect, route error, action 이후 화면 재검증을 소유한다.
- TanStack Query는 키 기반 중복 제거, stale 시간, 메모리 보관과 기능 단위 무효화를 소유한다.
- 그룹 게시물의 카테고리 첫 페이지와 커서 후속 페이지도 같은 15초 정책을 사용하며, 카테고리와 커서를 쿼리 키에 포함한다.
- loader는 QueryClient에서 데이터를 읽어 route component에 snapshot으로 전달한다. 캐시 무효화 후
  현재 loaderData도 바뀌어야 하면 React Router revalidation을 함께 사용한다.
- `shouldRevalidate`는 `post`, `tab`처럼 서버 데이터와 무관한 URL 상태 변경만 억제한다. 캐시를
  대신하는 용도로 광범위하게 사용하지 않는다.

## 6. 보안 및 점검 목록

- 쿼리 키에 비밀번호, 초대 토큰, signed URL 등 비밀 값을 넣지 않는다.
- signed URL은 메모리 쿼리 캐시에만 두고 키의 `userId`로 격리하며, 사용자 전환 시 `queryClient.clear()`로
  함께 폐기한다. 별도의 모듈 수준 Map을 새로 만들지 않는다 — 그 Map은 `clear()`가 닿지 않아
  로그아웃 뒤에도 유효한 URL이 남는다.
- 사용자 A에서 로그아웃한 뒤 같은 탭에서 사용자 B로 로그인해도 A의 데이터가 첫 화면에 나타나지 않는지 테스트한다.
- 그룹 탈퇴·삭제·권한 회수 뒤 접근 불가능한 상세 캐시를 즉시 제거하는지 테스트한다.
- 새 mutation을 추가할 때 이 문서의 무효화 규칙과 해당 query-key 테스트를 함께 갱신한다.
- 캐시 적용 범위를 새 기능으로 넓힐 때 staleTime과 mutation 영향을 먼저 이 문서에 기록한다.
