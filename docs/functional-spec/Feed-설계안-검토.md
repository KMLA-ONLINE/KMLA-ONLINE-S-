# 피드 설계안 구현 검토

> **대체된 검토 문서:** 이 문서는 당시의 구현 검토와 사용자 편집 이력을 보존한다. 결정된 기능 요구사항은 [피드 및 그룹](02-feed-and-groups.md)과 [게시물 및 상호작용](03-posts-and-interactions.md), 결정된 구현 경계는 [홈 통합 피드 랭킹 설계](../FEED_RANKING.md)를 따른다. 아래의 읽음 상태, 단계별 범위 및 mutable `bumped_at` 권고는 최종 결정이 아니다.

> [Feed-설계안.md](Feed-설계안.md)를 현재 스키마·코드와 대조한 검토 문서다.
> 설계안에 이미 반영한 항목은 지웠다. 여기 남은 것은 아직 결정하거나 구현해야 하는 것뿐이다.

## 0. 결론

**구현 가능하다.** ML도, 애플리케이션 서버도 필요 없다. Postgres 함수 하나와 비정규화 컬럼
하나면 랭킹·`#업`·도배 방지·페이지네이션이 모두 성립한다.

남은 갈림길은 둘이다.

| 항목               | 쟁점                                                                       | 위치     |
| ------------------ | -------------------------------------------------------------------------- | -------- |
| `#업` 판정 방식    | 댓글 본문을 매번 훑으면 인덱스가 안 먹는다.`posts.bumped_at` 비정규화가 답 | 2.1      |
| 페이지당 총량 제한 | 커서 페이지네이션과 정면으로 부딪힌다. v1에 넣을지 결정이 필요하다         | 2.5, 4장 |

절별 판정:

| 절  | 내용         | 판정                                              |
| --- | ------------ | ------------------------------------------------- |
| 1   | 피드 범위    | 스키마 그대로 구현 가능                           |
| 2   | 기본 랭킹    | 구현 가능                                         |
| 3   | `#업`        | 비정규화 필요 (2.1). 그룹 게시물 전용             |
| 4   | 도배 방지    | 연속 제한은 쉽다. 페이지당 총량이 복잡도의 대부분 |
| 5   | 페이지네이션 | 구현 가능                                         |
| 6   | 응답 정보    | 구현 가능. 첨부를 같은 행에 담아야 한다 (2.7)     |
| 7   | 읽음 상태    | 구현 가능. 저장 위치 재고 권장 (2.6)              |
| 8   | 생탐         | 구현 가능. 관련 기수 조인만 유의 (2.8)            |

---

## 1. 지금 코드가 어디까지 와 있나

피드 feature는 **전부 mock이다.** `app/features/feed/`는 파일 5개뿐이고 `data/queries.ts`는
`mock.ts` 배열을 슬라이스해 돌려준다. 주석이 이미 `list_feed_posts()` RPC가 생기면 mock을
지우라고 적어 두었다. `model/types.ts`의 `FeedPost.post_id`는 `number`지만 실제 `posts.id`는
`uuid`이고, 클라이언트 `PAGE_SIZE`는 10이지만 설계안은 20이다.

반면 **재사용할 기반은 이미 다 있다.**

| 필요한 것                       | 이미 있는 것                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| 후보 → 페이지 → 수화 패턴       | `list_profile_posts` + `private.read_profile_posts` (`20260820080532`) |
| 그룹 글 카드 필드 + 권한 플래그 | `list_group_posts` (`20260815041500`)                                  |
| 댓글 수                         | `posts.comment_count` 비정규화 + 트리거 (`20260814100324`)             |
| 반응 요약                       | `read_profile_posts`의 lateral 집계 (`total`, 상위 3개, `my_reaction`) |
| 최상위 댓글 판별                | `post_comments.depth = 0`, `deleted_at is null` + 전용 인덱스          |
| 댓글 실제 작성자                | `private.comment_authors.profile_id` (익명이어도 실제 작성자를 안다)   |
| 글 실제 작성자                  | `private.post_authors.profile_id`                                      |
| 익명·운영진 표시 이름           | `list_group_posts`의 `author_label` 규약                               |
| 복학생 표시                     | `profiles.is_returning_student`                                        |
| 주기 작업                       | `pg_cron` (`20260813044649`에서 이미 사용 중)                          |

즉 피드는 **새 도메인이 아니라 기존 두 목록 RPC의 합집합 + 정렬 규칙**이다.

---

## 2. 어떻게 구현할 것인가

### 2.1 랭킹 키를 컬럼 하나로 모은다

설계안의 랭킹은 사실상 하나의 정렬 키로 압축된다.

```text
rank_at   = coalesce(bumped_at, published_at)   -- 인덱스에 담기는 값
rank_time = rank_at + 보정(feed_epoch)          -- 조회 시점에 계산
```

`bumped_at`은 `posts`에 추가하고 **트리거로 유지한다.** `comment_count`가 이미 같은 방식이라
선례가 있다. 트리거 안에서 쿨다운까지 강제하면 "마지막 유효 `#업` 후 1시간"이 클라이언트
규칙이 아니라 **DB 불변식**이 된다 — AGENTS.md가 요구하는 형태다.

```text
post_comments AFTER INSERT
  where depth = 0
    and author_identity <> 'anonymous'
    and btrim(body) = '#업'
    and posts.kind = 'group'
    and (posts.bumped_at is null or now() >= posts.bumped_at + interval '1 hour')
  → posts.bumped_at = now()
```

이렇게 하면 얻는 것:

- 후보 선별이 **인덱스 스캔 하나**로 끝난다. 댓글 본문을 훑지 않는다.
- `#업`으로 6시간 창 밖에서 올라온 글도 같은 정렬 키를 쓴다. 별도 union이 필요 없다.
- 쿨다운을 우회하는 `#업` 연타가 원천 차단된다.

`#업`이 그룹 게시물 전용이라 개인 글은 항상 `rank_at = published_at`이다. 기존
`posts_public_profile_feed_idx`를 그대로 쓰면 되고, 새로 필요한 인덱스는 그룹 쪽 하나뿐이다.

```sql
-- posts_group_recent_idx의 피드용 대응
(group_id, rank_at desc, id desc)
  where kind = 'group' and published_at is not null and deleted_at is null
```

`rank_at`을 `generated always as (coalesce(bumped_at, published_at)) stored`로 두면 트리거는
`bumped_at`만 건드리고 정렬 키는 자동으로 따라온다.

### 2.2 hot / cold 두 구간으로 자른다

설계안 §2의 "6시간이 지나면 다시 사실상 최신순"은 성능 설계 그 자체다.

| 구간 | 조건                    | 계산                             |
| ---- | ----------------------- | -------------------------------- |
| hot  | `rank_at > epoch - 6h`  | 댓글·반응 집계 + 감쇠 보정       |
| cold | `rank_at <= epoch - 6h` | 순수`rank_at desc, id desc` 스캔 |

hot은 항상 cold보다 위다. hot의 최소 `rank_time`은 `epoch - 6h`이고 보정은 음수가 아니며,
cold의 최대 `rank_at`은 `epoch - 6h`이기 때문이다. 생탐 -60분 조정만 이 경계를 침범할 수
있으므로 **hot 후보 창을 7시간으로 잡고 6시간 경계에서 자르면** 성질이 유지된다.

결과적으로 비싼 집계는 최근 6시간 글에만 걸린다. 스크롤이 깊어질수록 쿼리가 **싸진다.**

가입 그룹이 여러 개인 후보 선별은 그룹별 lateral top-K로 뽑고 합친다. 위 인덱스의 선두가
`group_id`라 그룹마다 20행만 읽는다.

```text
후보 = (가입 그룹마다 lateral top-20)
     ∪ (공개 개인 글 top-20)
  → rank_time 계산
  → 도배 제한
  → 상위 20
```

### 2.3 랭킹 계산식

설계안 §2가 고정한 규칙을 그대로 SQL로 옮기면 된다. 집계는 `feed_epoch` 시점으로 잘라야
페이지를 넘기는 사이에 순서가 흔들리지 않는다.

```text
R   = count(post_reactions where created_at <= epoch)
C   = count(post_comments where depth = 0 and deleted_at is null
            and created_at <= epoch
            and btrim(body) <> '#업'
            and comment_authors.profile_id <> post_authors.profile_id)
경과 = epoch − rank_at
보정 = min(4 × R + 8 × C, 40 × (1 − 경과 / 6시간))
```

`post_reactions.created_at`·`post_comments.created_at` 둘 다 이미 있고, 최상위 댓글 인덱스도
이미 있다. 이러면 `rank_time`이 `(post, epoch)`의 **순수 함수**가 되어 pgTAP로 직접 검증된다.

"작성자가 자기 게시물에 단 댓글" 제외는 **실제 작성자끼리** 비교해야 한다.
`private.post_authors.profile_id`와 `private.comment_authors.profile_id`를 맞대는 것이지,
표시용 `display_author_profile_id`를 보는 것이 아니다. 익명 글에 익명으로 단 자기 댓글은
표시 정보로는 잡히지 않고 이 비교로만 걸러진다.

`#업`된 글의 보정은 설계안대로 0이다 (`bumped_at is not null` → `보정 = 0`).

### 2.4 커서와 `feed_epoch`

커서는 불투명 토큰으로 감싼다. 클라이언트가 값을 만들지 않는다는 설계안 원칙과 일치한다.

```text
cursor = base64({ epoch, section: "hot" | "cold", rank_time, post_id, carry: uuid[] })
```

- `epoch`은 첫 페이지 응답이 정하고 이후 페이지가 그대로 되돌려준다.
- `section`이 있어야 hot에서 cold로 넘어갈 때 비교 대상이 바뀐다.
- `carry`는 2.5의 도배 제한에 밀린 글이다.

새로고침은 커서 없이 호출해 `epoch`을 새로 받는다.

### 2.5 도배 방지는 두 단계로 나눈다

"연속 노출 제한"과 "페이지당 총량 제한"은 난이도가 완전히 다르다.

**연속 제한(같은 사용자 2개 / 같은 그룹 3개)** 은 쉽다. 페이지 20개를 확정한 뒤 배열
안에서만 재배치하면 된다. 순수 함수라 Vitest로도 pgTAP로도 검증된다.

**페이지당 총량 제한(작성자 4개 / 그룹 10개)** 이 복잡도의 대부분이다. "숨기지 않고 뒤로
이동"은 밀린 글이 **다음 페이지 맨 앞**에 와야 한다는 뜻인데, `(rank_time, id)` 커서로는
표현할 수 없다. 두 가지 길이 있다.

| 방식              | 방법                                                                                              | 비용                                                  |
| ----------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| A. carry-over     | 후보를 40개 오버페치 → 제한 적용해 20개 확정 → 밀린 id를 커서`carry`에 실어 다음 페이지 앞에 붙임 | 커서가 커지고 로직이 늘지만 설계안 의미를 정확히 지킴 |
| B. 후보 단계 제한 | 후보 선별 시`row_number()`로 작성자당 4개·그룹당 10개만 남김                                      | 훨씬 단순. 대신 잘린 글은 그 페이지에서 사라진다      |

**A를 권한다.** B는 "후보가 부족하면 제한보다 게시물을 보여주는 것을 우선한다"는 §4 마지막
규칙과 충돌하기 쉽다.

### 2.6 읽음 상태

RPC 형태는 설계안에 반영했다. 남은 권장 사항이 둘 있다.

1. **저장 위치를 `profiles`에서 분리한다.** `profiles`는 거의 모든 화면이 읽는 뜨거운
   테이블이고 `updated_at` 트리거가 걸려 있다. 피드를 열고 닫을 때마다 프로필 행을 쓰면
   불필요한 write 증폭이 생긴다.
   `public.feed_read_states(profile_id primary key, last_seen_at timestamptz not null)`가 낫다.
2. **미래 값을 오류로 던지는 대신 `least(p_seen_at, now())`로 클램프한다.** `p_seen_at`은
   서버가 준 `feed_epoch`이라 미래일 수 없다. 미래 값이 오면 버그이거나 장난인데, 어느
   쪽이든 사용자에게 오류를 보여줄 이유가 없다.

`new_post_count`는 후보 조건을 그대로 태워야 하므로 목록 RPC 안에서 계산한다 (2.7). UI가 `99+`로
자르므로 **서브쿼리에 `limit 100`을 걸어 세면** 가입 그룹 수와 무관하게 비용이 고정된다.

"본인이 작성한 글 제외"는 `display_author_profile_id`가 아니라
`private.post_authors.profile_id`로 판정해야 한다. 익명으로 쓴 자기 글도 빠져야 한다.

호출 시점 규칙(이탈 / 탭 전환 / 백그라운드 / 스크롤 5초 정지 / 체류 3초 미만 생략)은 전부
클라이언트 정책이다. `app/features/feed/model/`에 순수 함수로 두면 Vitest로 검증된다.

### 2.7 응답 행 모양

그룹 글과 개인 글을 한 테이블로 반환해야 하므로 넓은 행 하나에 nullable 컬럼을 섞는다.
기존 두 RPC의 컬럼명을 그대로 쓰면 클라이언트 타입이 재사용된다.

```text
공통  post_id, kind, body, author_identity, author_pub_id, author_name,
      author_avatar_path, author_label, published_at, edited_at,
      comment_count, reaction_count, top_reactions, my_reaction,
      attachments, rank_time, is_new, is_author
그룹  group_id, group_slug, group_name, title, category_name
개인  timeline_pub_id, timeline_name, visibility
첫 페이지  feed_epoch, last_feed_seen_at, new_post_count
```

`can_edit` / `can_delete` / `can_pin`은 그룹 역할 조인이 필요하고 피드 카드에서 쓸 일이 거의
없다. **피드에서는 빼고 상세 화면의 `get_group_post` / `get_profile_post`에 맡기기를 권한다.**

**첨부는 이 행 안에 배열로 담는다.** `list_post_attachments`는 글 하나짜리라 목록에서 그대로
쓰면 20-way N+1이고, 배치 RPC로 바꿔도 게시물 id를 먼저 받아야 하므로 `clientLoader`에
**의존 waterfall**이 생긴다. AGENTS.md가 금지하는 형태다. `top_reactions`가 이미 배열로
나가고 있으니 같은 방식으로 lateral 하나를 더 붙이면 된다.

첫 페이지 메타(`feed_epoch`, `last_feed_seen_at`, `new_post_count`)도 같은 RPC가 돌려준다.
`feed_epoch`은 서버가 정하는 값이라 애초에 다른 곳에서 받을 수 없고, `new_post_count`는 후보
조건이 같아 멤버십 조회를 재사용한다. 이후 페이지에서는 `null`이다.

결과적으로 **피드 한 페이지는 RPC 호출 한 번**이다.

### 2.8 생탐 후보와 관련 기수

"생탐"은 스키마에 없는 개념이지만 **후보 판정에는 새 컬럼이 필요 없다.**

```text
생탐 = kind = 'profile' and display_author_profile_id <> timeline_profile_id
```

관련 기수는 `profiles.cohort`로 판정하고, 복학생은 `is_returning_student = true`일 때
`cohort`와 `cohort + 1` 둘 다로 친다.

다만 이 필터는 `timeline_profile_id`로 `profiles`를 조인해야 해서 2.1의 인덱스만으로는 걸러지지
않는다. 재학생 규모에서는 후보 수가 작아 문제되지 않지만, 부담이 되면 대상자의 기수를
`posts`에 비정규화하는 선택지가 있다. 처음부터 할 일은 아니다.

### 2.9 페이지당 쿼리 비용

한 페이지를 그리는 데 드는 비용은 이렇다.

| 구간                | 횟수                       | 비고                                                        |
| ------------------- | -------------------------- | ----------------------------------------------------------- |
| 브라우저 → Supabase | **RPC 1회**                | 첨부와 첫 페이지 메타를 같은 행에 담았을 때 (2.7)           |
| 후보 선별           | 가입 그룹 수 × 20행 + 20행 | 인덱스 튜플만 읽는다. 그룹 30개면 약 620행                  |
| 랭킹 집계           | hot 후보 수                | 6시간 이내 글에만. 학교 규모에서는 수십 건                  |
| 수화                | 페이지 20행                | 행마다 반응 집계·첨부·프로필 조인. 전부 PK/부분 인덱스 조회 |

**이 규모에서는 많지 않다.** 무거운 축은 후보 선별의 인덱스 튜플 수백 개인데, 이건 목록
쿼리로는 평범한 양이고 스크롤이 깊어질수록 hot 집계가 사라져 더 싸진다.

주의할 점 셋:

1. **hot 필터를 집계보다 먼저 건다.** 후보 전체에 반응 집계를 돌린 뒤 6시간으로 거르면 집계
   횟수가 수십 배가 된다. `rank_at > epoch - 7h`로 좁힌 다음 집계해야 한다.
2. **`reaction_count`는 비정규화하지 않는다.** 랭킹이 `feed_epoch` 시점 값을 쓰는데
   비정규화 카운터는 현재 값이라 애초에 못 쓴다. `post_reactions_summary_idx`를 타는 lateral
   집계 20번이 더 정확하고 충분히 싸다. `comment_count`는 이미 비정규화되어 있으니 그대로 쓴다.
3. **그룹별 lateral은 그룹 수에 비례한다.** 공식 그룹은 재학생이 전원 자동 가입하므로 그룹
   수가 곧 fan-out이다. 공식 그룹이 수십 개를 넘어가면 `posts (rank_at desc) where kind = 'group'`
   전역 인덱스를 하나 두고 `group_id = any(...)`로 훑는 편이 빨라진다. 대부분의 그룹에
   속한 재학생일수록 전역 스캔이 금방 20개를 채우기 때문이다. 반대로 가입 그룹이 적은
   교사에게는 지금의 lateral이 낫다. 지금 정할 일은 아니고, 그룹 수가 늘면 `EXPLAIN`으로
   갈아타면 된다.

### 2.10 마이그레이션 순서

각 단계마다 pgTAP를 같이 넣는다.

| 단계 | 내용                                                                                           |
| ---- | ---------------------------------------------------------------------------------------------- |
| A    | `posts.bumped_at` + `rank_at` 생성 컬럼 + `#업` 트리거(쿨다운 포함) + 피드 인덱스 1개          |
| B    | `private.feed_rank_time(...)` + `public.list_feed_posts(...)` + `private.read_feed_posts(...)` |
| C    | 읽음 상태 저장소 +`mark_feed_seen`                                                             |

클라이언트는 그 다음이다. `mock.ts` 삭제 → `model/types.ts`를 생성 타입에서 파생 →
`home.tsx`의 `clientLoader` 커서 교체 → `FeedScreen` 카드/목록 뷰.

---

## 3. 개선 제안

### 반드시

1. **`#업`을 `posts.bumped_at` 비정규화로** (2.1). 쿨다운이 DB 불변식이 된다.

### 설계 품질

2. **`rank_time`을 SQL 함수 하나로 분리한다.** `(post, epoch) → timestamptz`. 랭킹 규칙이
   목록 쿼리 안에 흩어지면 상수 하나 바꿀 때마다 쿼리를 다시 읽어야 한다. 분리하면 설계안
   §9 상수 표가 코드의 한 곳과 1:1로 대응하고 pgTAP가 그 표를 그대로 테스트한다.
3. **읽음 상태를 `feed_read_states` 별도 테이블로** (2.6).
4. **`new_post_count`에 `limit 100`** (2.6).
5. **첨부와 첫 페이지 메타를 목록 RPC 안으로** (2.7). 별도 호출로 빼면 `clientLoader`에
   의존 waterfall이 생긴다.
6. **정렬 역전 가능성을 문서에 명시한다.** 보정 때문에 새로고침하면 두 글의 순서가 뒤집힐
   수 있다. 의도된 동작이지만 적어 두지 않으면 나중에 버그로 신고된다.

### 문서 구조

7. **기능 명세와 기술 설계를 분리한다.** AGENTS.md가 요구하는 구분인데 설계안은 한 파일에
   섞여 있다. 피드 동작 규칙은 [02-feed-and-groups.md](02-feed-and-groups.md) 6장에 흡수하고,
   랭킹 수식·컬럼·RPC·커서는 `docs/FEED_RANKING.md`로 빼는 편이 낫다.
   [STORAGE_BUCKETS.md](../STORAGE_BUCKETS.md)·[CONTENT_FORMATTING.md](../CONTENT_FORMATTING.md)와
   같은 위치다.

---

## 4. v1 범위 제안

설계안 전체를 한 번에 넣기보다 이 순서를 권한다. 각 단계가 독립적으로 배포 가능하다.

| 단계 | 범위                                                                                                        | 근거                                                                                                                    |
| ---- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| v1.0 | 후보 범위(§1) + hot/cold 랭킹(§2) +`#업`(§3) + 연속 노출 제한(§4 앞부분) + 페이지네이션(§5) + 읽음 상태(§7) | 여기까지가 "통합 피드"의 최소 완성형이다                                                                                |
| v1.1 | 페이지당 총량 제한(§4 뒷부분)                                                                               | carry-over 커서가 필요해 복잡도가 급증한다. 후보가 적은 초기에는 걸릴 일도 드물다                                       |
| v1.2 | 생탐(§8)                                                                                                    | 관련 기수 필터가 후보 선별 인덱스 밖에 있어 따로 검증이 필요하다. "오늘의 생일" 영역은 피드와 독립이므로 먼저 내도 된다 |

`#업`을 v1.0에 넣는 이유는 그것이 이 피드에서 **유일하게 새로운 제품 아이디어**이기 때문이다.
나머지는 최신순 정렬의 변형이지만 `#업`은 오래된 글을 되살리는 신호이고, 비정규화 컬럼 하나로
값싸게 구현된다.

---

## 최종 판정

**설계안은 구현 가능하고, 규모에도 맞다.** 랭킹 수식이 단순하고 6시간 창 밖은 순수 최신순이라
스크롤이 깊어질수록 쿼리가 싸진다. ML 없이 규칙만으로 간다는 판단도 적절하다.

**남은 것은 2.1의 비정규화와 2.5의 총량 제한 범위 결정뿐이다.** 나머지는 기존 두 목록 RPC의 패턴을
그대로 따라가면 된다.
