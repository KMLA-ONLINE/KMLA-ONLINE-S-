# 전역 검색 (사람 · 그룹) 설계

## 배경

[functional-spec/accounts.md §3.3](../../functional-spec/accounts.md)은 현재 다음과 같이 정의한다.

> 사람·그룹·게시물을 한 번에 찾는 전역 검색은 아직 제공하지 않는다. 데스크톱 헤더의 검색창은 자리만 잡아 둔 상태다.

`app/features/app-shell/components/app-header.tsx`의 검색 입력은 `name`/`value`/`onSubmit`이 없는 순수 장식 요소다. 이번 작업은 이 자리에 실제 동작하는 검색을 구현한다.

## 범위

- 검색 대상: 승인된 사용자 프로필 이름, 그룹 이름. **게시물 검색은 범위 밖.**
- 매칭 필드: 이름만. `pub_id`, 기수 등은 범위 밖(향후 확장 가능하지만 지금은 불필요).

## 확정된 결정 (브레인스토밍에서 사용자가 직접 선택)

1. **결과 표시 — 드롭다운 패널.** 검색창 아래 사각형 패널에 결과를 표시한다. 전용 검색 결과 페이지로 이동하지 않는다. (시각 목업에서 A안 선택)
2. **검색 실행 시점 — Enter 시에만 서버 요청.** 타이핑마다 조회하지 않는다. 사용자가 egress 비용을 명시적으로 우려했다.
3. **최근 기록 — 클릭한 항목(사람/그룹) 저장, 아바타 포함.** 검색어 텍스트가 아니라 실제로 눌러서 들어간 프로필/그룹을 저장한다. 클릭하면 검색을 거치지 않고 바로 이동한다. (시각 목업에서 B안 선택)
4. **모바일 — 풀스크린 오버레이.** 검색창을 누르면 Facebook처럼 기존 화면을 덮는 전체 화면으로 전환한다. 기존 화면은 언마운트하지 않고 그 위에 얹는다 (뒤로가기로 복귀).
5. **데스크톱 — 기존 placeholder를 실제 컴포넌트로 교체.**

## 판단해서 정한 세부사항

담당자가 자리를 비운 상태에서 결정했다. 기존 코드베이스 관례를 최대한 따랐고, 근거를 남긴다.

| 항목           | 결정                                                                                                                                                 | 근거                                                                                                                                                                                                           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 최소 글자 수   | 2자 이상                                                                                                                                             | 그룹 멤버 검색(§7.9), 관리자 후보 검색(§16.4)과 동일한 기존 컨벤션. 승인 사용자 누구나 쓸 수 있는 첫 ungated 전역 텍스트 검색이므로 egress에 더 보수적이어야 함                                                |
| 그룹 노출 범위 | 공식 그룹 전체 + 비공식 그룹 중 초대 전용이 아닌 것                                                                                                  | `discover_groups`와 동일 필터. 초대 전용 그룹은 존재 자체를 그룹 찾기(§7.6)에서도 노출하지 않으므로 전역 검색도 같은 보안 경계를 지켜야 함                                                                     |
| 사람 노출 범위 | 승인 상태의 모든 프로필 (재학생/졸업생/교사)                                                                                                         | 기존 프로필 열람 규칙(§12.1)과 동일 — 프로필은 승인 사용자 전체에게 공개됨                                                                                                                                     |
| 결과 개수      | 사람 최대 5개 + 그룹 최대 5개, 페이지네이션 없음                                                                                                     | 드롭다운 패널의 공간 제약. "이름 정도만 찾으면 됨"이라는 요청 규모에 맞춰 최소 범위로 시작 (YAGNI)                                                                                                             |
| 정렬           | 정확 일치 → 접두 일치 → 부분 일치, 동순위는 이름순                                                                                                   | `discover_groups`의 `sort_rank`와 동일한 원칙 재사용                                                                                                                                                           |
| 모바일 진입점  | 홈 화면 `PageHeader`에 검색 아이콘 추가                                                                                                              | 모바일 전용 전역 헤더가 없어 페이지별로 붙여야 함. 가장 많이 보는 화면부터 시작, 다른 화면은 후속 확장                                                                                                         |
| 최근 기록 저장 | `kmla-online:search-recent:v1`, 최대 10개, LRU, 로그아웃해도 지우지 않음                                                                             | 기존 `visited-posts.ts`/`prompt-storage.ts`와 동일한 버전드 키 패턴. 계정별 분리 안 함(다른 localStorage 관행과 동일)                                                                                          |
| 백엔드         | `profiles`에 `groups.search_name`과 동일한 generated 컬럼 + trigram GIN 인덱스 추가, 새 RPC `search_directory(p_query)` 하나가 사람+그룹을 함께 반환 | 기존 `discover_groups`가 유일하게 인덱스를 갖춘 검색 패턴이고, 지금까지 없던 "누구나 쓰는 프로필 이름 검색"이므로 `admin_list_members`류의 무인덱스 `ilike`를 그대로 재사용하면 안 됨(탐색 에이전트 조사 결과) |

## 아키텍처

### 데이터베이스

- 새 migration:
  - `profiles.search_name` — `generated always as (lower(regexp_replace(btrim(name), '[[:space:]]+', '', 'g'))) stored`, `groups.search_name`과 동일한 정규화.
  - `profiles_search_name_trgm_idx` — `gin (search_name extensions.gin_trgm_ops) where (status = 'approved')`. 승인된 사용자만 인덱싱 대상.
  - `search_directory(p_query text)` — `security definer`, `search_path = ''`. 내부에서:
    - `p_query`를 정규화하고 2자 미만이면 빈 결과 반환.
    - 사람: `status = 'approved'`인 프로필의 `search_name`을 대상으로 exact/prefix/substring 랭킹, 상위 5개.
    - 그룹: `kind = 'official' or join_policy <> 'invite_only'` 필터 후 동일 랭킹, 상위 5개.
    - 두 결과를 하나의 rowset(또는 두 개의 out 테이블)으로 반환.
  - grants: `authenticated`에게만 `execute`.

### 프론트엔드

새 feature `app/features/search/`:

- `data/queries.ts` — `searchDirectory(query)` → `getSupabase().rpc("search_directory", {...})`.
- `model/recent-searches.ts` — localStorage 래퍼. `addRecentSearchEntry(entry)`, `getRecentSearchEntries()`, `removeRecentSearchEntry(id)`. 기존 `visited-posts.ts` 패턴(SSR 가드, try/catch, cap) 재사용.
- `model/format.ts` — `hasMinimumSearchLength` (2자, `admin`/`groups`의 `normalizeAdminSearch`와 동일 모양).
- `components/global-search.tsx` — 데스크톱: 앵커된 드롭다운. 포커스 시 최근 기록, Enter 시 `searchDirectory` 호출 후 결과로 교체. 바깥 클릭 시 닫힘.
- `components/mobile-search-overlay.tsx` — 모바일: 풀스크린. 동일한 최근 기록/검색 로직을 공유하는 내부 훅으로 묶는다 (`model/use-directory-search.ts` 같은 공용 훅으로 중복 방지).
- `index.ts` — 배럴.

통합 지점:

- `app/features/app-shell/components/app-header.tsx`의 placeholder `<Input>`을 `<GlobalSearch />`로 교체 (`max-md:hidden`이므로 데스크톱 전용은 그대로 유지).
- 모바일: 홈 라우트의 `PageHeader` actions에 검색 아이콘 버튼 추가 → 클릭 시 `<MobileSearchOverlay />` 오픈(라우팅 없이 오버레이 컴포넌트, 또는 `?search=1` 같은 얕은 상태 — 구현 계획에서 확정).

### 캐시

`DATA_CACHE_POLICY.md`에 항목 추가: `["search", "directory", query]`, staleTime 15초 (같은 세션 내 같은 검색어 재조회 시 재사용, egress 절감과 신선도의 절충).

### 문서 갱신

- `docs/functional-spec/accounts.md` §3.3의 "전역 검색은 아직 제공하지 않는다" 문구를 제거하고, [AGENTS.md](../../../AGENTS.md) 장 번호 규칙("절을 추가할 때는 해당 장의 마지막 번호 뒤에 붙인다")에 따라 3장의 마지막 절(현재 §3.5) 뒤에 새 **§3.6 전역 검색**을 추가해 실제 동작을 정의한다.

## 테스트 계획

- pgTAP (`supabase/tests/`): `search_directory`의 그룹 가시성 필터링(초대 전용 제외 확인), 사람 승인 상태 필터링, 랭킹 순서, grants.
- Vitest: `GlobalSearch`/`MobileSearchOverlay` 컴포넌트(포커스 시 최근 기록 노출, 2자 미만 제출 차단, Enter 제출, 결과 클릭 시 최근 기록에 추가), `recent-searches` 모델(LRU 캡, SSR 가드).
- 수동: 모바일 풀스크린 오버레이 진입/뒤로가기, 데스크톱 바깥 클릭으로 닫기.

## 스코프 밖 (다음 확장 후보)

- 게시물 검색, `pub_id`/기수 매칭, 페이지네이션·더보기, 모바일의 홈 이외 진입점, 검색 결과 캐시 공유.
