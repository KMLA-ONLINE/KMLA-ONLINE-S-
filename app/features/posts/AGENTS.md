# Posts Feature Rules

기능 요구는 `docs/functional-spec/03-posts-and-interactions.md`, 본문 형식은 `docs/CONTENT_FORMATTING.md`에 있다. 이 문서는 코드와 스키마에서 지켜야 하는 불변식만 적는다.

## 신원

- 게시물과 댓글의 실제 작성자는 `private.post_authors` / `private.comment_authors`에만 있다. 클라이언트 가독 행에는 표현용 값(`author_identity`, `display_author_profile_id`, `anon_alias_number`)만 둔다.
- 화면에 띄울 신원 선택지는 `model/identity.ts`의 `resolveIdentityOptions()` 하나로 정한다. 게시물 작성과 댓글 작성이 같은 규칙을 쓰므로 화면마다 다시 계산하지 않는다.
- 신원 판정의 실제 경계는 RPC 안이다. 클라이언트 계산은 UX용이다.

## 익명 번호

- 익명 번호는 게시물 단위다. 원본은 `private.post_anonymous_aliases`에 있고 클라이언트 grant가 없다 — 번호로 같은 사용자를 여러 게시물에 걸쳐 이을 수 있게 되기 때문이다.
- `anon_alias_number = 0`은 `글쓴이`, 1 이상은 `익명n`이다. `0`은 alias 테이블을 소비하지 않는다.
- `글쓴이`는 **게시물 자체가 익명일 때만** 붙인다. 실명 게시물의 작성자에게 붙이면 실명과 익명 댓글이 연결돼 익명 선택이 무너진다.
- 새 번호는 게시물 단위 advisory lock 안에서 발급한다. `unique (post_id, alias_number)`가 최후 방어선이다.

## 댓글 저장과 삭제

- `public.post_comments`에는 select grant조차 주지 않는다. 직접 select를 열면 tombstone 판정을 건너뛰고 삭제된 본문을 읽을 수 있다. 모든 읽기는 definer RPC를 거친다.
- 최상위 댓글을 지우면 같은 `root_comment_id`의 모든 행에 `deleted_at`을 찍는다.
- tombstone은 저장 상태가 아니라 읽기 시 판정이다: **삭제된 댓글은 살아 있는 자손이 하나라도 있을 때만 보인다.** 이 규칙 하나로 최상위 삭제(자손까지 삭제되므로 전부 사라짐)와 중간 삭제(자손이 남으면 표시 유지)가 모두 설명된다. 클라이언트에서 흉내 내지 말고 답글 묶음을 다시 읽어라.
- `depth`와 `root_comment_id`가 실제 부모와 맞는지는 CHECK로 표현할 수 없다. 쓰기 경로가 `create_post_comment` 하나뿐이라는 전제 위에 서 있으므로 다른 insert 경로를 만들지 마라.
- 댓글 본문은 평문이다. 게시물의 Markdown 파이프라인(`model/markdown.ts`)을 타지 않는다.

## 카운트

- `posts.comment_count`는 트리거가 유지하는 비정규화 값이며 삭제되지 않은 댓글만 센다. 목록 화면이 게시물마다 댓글을 세지 않게 하려는 것이다.
- 이 컬럼을 노출하는 `list_group_posts`와 `get_group_post`는 반환 모양이 바뀌면 `drop function` 후 다시 만들어야 하고, 그때 grant를 다시 발급해야 한다. pgTAP이 `has_function_privilege`로 지킨다.
- 검색 결과에는 댓글 수를 표시하지 않으므로 `search_group_posts`는 이 컬럼을 반환하지 않는다. 그래서 `GroupPostSearchResult`는 `GroupPost`와 다른 타입에서 파생한다.

## 화면 갱신

- 댓글 뮤테이션은 route를 재검증하지 않는다. 재검증하면 펼쳐 둔 답글 묶음과 위로 불러온 이전 페이지가 통째로 초기화된다. RPC가 돌려주는 정본 행을 `hooks/use-post-comments.ts`에서 병합한다.
- 게시물 목록 카드의 댓글 수는 다음 이동이나 재검증까지 낡은 값으로 남는다. 알고 두는 것이지 버그가 아니다.
