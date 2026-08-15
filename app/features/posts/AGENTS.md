# posts feature

그룹 게시물·댓글·반응을 소유한다. 기능 요구는 `docs/functional-spec/03-posts-and-interactions.md`,
본문 형식은 `docs/CONTENT_FORMATTING.md`에 있다. 여기에는 코드만 읽어서는 **왜 그런지** 알 수 없는
불변식만 적는다.

## 신원

- 실제 작성자는 `private.post_authors` / `private.comment_authors`에만 있다. 클라이언트 가독 행에는 표현용 값(`author_identity`, `display_author_profile_id`, `anon_alias_number`)만 둔다.
- 신원 판정의 경계는 RPC 안이다. 클라이언트의 `resolveIdentityOptions()`는 선택지를 그리기 위한 것이고, 게시물과 댓글이 같은 규칙을 쓰므로 화면마다 다시 계산하지 않는다.
- 익명 번호는 게시물 단위이며 원본은 `private.post_anonymous_aliases`에만 있다. 클라이언트에 열어 주면 번호로 같은 사용자를 여러 게시물에 걸쳐 이을 수 있다.
- `글쓴이`는 **게시물 자체가 익명일 때만** 붙인다. 실명 게시물의 작성자에게 붙이면 실명과 익명 댓글이 연결돼 익명 선택이 무너진다.
- 반응의 익명 여부는 쓰는 시점의 그룹 정책으로 정해 `is_anonymous`에 박는다. 읽을 때 정책을 다시 보면, 그룹이 익명을 해제하는 순간 익명을 약속받고 눌렀던 과거 반응까지 실명으로 드러난다(기능 명세 §10.4).

## 직접 접근을 막은 테이블

`post_comments`, `post_reactions`, `comment_reactions`에는 select grant조차 주지 않는다. 읽기도 쓰기도 definer RPC를 거친다.

- 댓글은 직접 select를 열면 tombstone 판정을 건너뛰고 삭제된 본문이 읽힌다.
- 반응 행은 통째로 신원이라(누가·무엇을·언제) 표현용으로 떼어 낼 값이 없다. 직접 열면 익명 반응자의 `profile_id`가 그대로 읽힌다. 게시물·댓글처럼 `private` 테이블로 쪼개지 않은 이유도 같다 — 나눌 표현값이 없다.
- `depth`와 `root_comment_id`가 실제 부모와 맞는지는 CHECK로 표현할 수 없다. 쓰기 경로가 `create_post_comment` 하나라는 전제 위에 서 있으므로 다른 insert 경로를 만들지 마라.

## tombstone

- 저장 상태가 아니라 읽기 시 판정이다: **삭제된 댓글은 살아 있는 자손이 하나라도 있을 때만 보인다.** 최상위 삭제(같은 `root_comment_id` 전체에 `deleted_at`을 찍으므로 자손이 남지 않는다)와 중간 삭제가 이 한 줄로 모두 설명된다. 클라이언트에서 흉내 내지 말고 답글 묶음을 다시 읽어라.
- 답글의 `@작성자` 칩은 부모가 삭제돼도 남긴다. 지우면 답글이 갑자기 최상위 댓글처럼 보여 엉뚱한 사람에게 한 말로 읽힌다. 화면이 부모의 삭제 여부로 갈라질 일이 없으므로 응답에도 그 값을 넣지 않는다.

## 읽기 RPC의 반환 모양

컬럼을 더하거나 빼면 `create or replace`가 통하지 않는다. `drop function` 후 다시 만들고 **grant를 재발급해야 한다** — 빠뜨리면 런타임에서 42501로 터진다. pgTAP의 `has_function_privilege`가 지킨다. 댓글 쪽은 `private.read_post_comments` 하나를 고치면 네 개의 공개 RPC가 모양만 따라 바뀐다.

- `posts.comment_count`는 트리거가 유지하는 비정규화 값이며 삭제되지 않은 댓글만 센다. 목록 화면이 게시물마다 댓글을 세지 않게 하려는 것이다.
- 반응 수와 상위 반응은 비정규화하지 않는다. 반응 변경 한 번이 두 종류의 순위를 동시에 흔들어 트리거로 유지하기 까다롭고, 읽기 RPC의 lateral 집계가 `(post_id, reaction)` 인덱스를 탄다.
- `search_group_posts`는 댓글 수를 반환하지 않는다(검색 결과에 표시하지 않는다). 그래서 `GroupPostSearchResult`는 `GroupPost`가 아니라 검색 RPC에서 파생한다.

## 화면 갱신

- 댓글·반응 뮤테이션은 route를 재검증하지 않는다. 재검증하면 펼쳐 둔 답글 묶음과 위로 불러온 이전 페이지가 통째로 초기화된다. RPC가 돌려주는 정본 행을 병합한다(`hooks/use-post-comments.ts`).
- 반응은 누르는 즉시 로컬 계산으로 앞서 나가고 정본으로 덮는다. **상위 반응은 로컬에서 계산하지 마라** — 내 반응 하나로는 남들의 순위를 알 수 없다. `applyReactionLocally()`가 내 반응과 총계만 건드리는 이유다.
- 목록 카드의 댓글 수는 다음 이동이나 재검증까지 낡은 값으로 남는다. 알고 두는 것이지 버그가 아니다.

## 그 밖에

- 댓글 본문은 평문이다. 게시물의 Markdown 파이프라인(`model/markdown.ts`)을 타지 않는다.
- 줄바꿈 하나를 문단으로 가르는 `toMilkdownMarkdown()`은 편집기에 넣을 때만 쓴다. 이 변환을 공용 `toPostEditorMarkdown()`에 옮기지 마라 — `sanitizePostMarkdown()`과 `toPostRenderMarkdown()`이 같은 함수를 써서 정화 결과와 읽기 화면까지 함께 바뀐다.
- `model/reactions.ts`의 `REACTION_TYPES` 순서를 `public.post_reaction` enum과 맞춰 두어라. 서버가 같은 수의 상위 반응을 enum 순서로 가르므로, 어긋나면 화면과 서버의 "많이 쓰인 순"이 달라진다.
- 반응 그래픽은 `public/twemoji/15.1.0/<codepoint>.svg`에 담아 둔 Twemoji다. 서비스 워커가 `public/`을 프리캐시하므로 오프라인에서도 보인다. 실행 시점에 CDN에서 받지 마라.
