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

## 본문 형식

- 저장 형식은 줄바꿈 하나를 문단 안의 soft break로 둔다. 읽기 화면은 문단에 걸린 `whitespace-pre-wrap`이 그대로 줄바꿈으로 보여준다.
- ProseMirror 문서에는 soft break에 해당하는 노드가 없다. 그래서 Milkdown에 넣을 때만 `toMilkdownMarkdown()`으로 줄바꿈 하나를 문단으로 갈라 준다. 이걸 빠뜨리면 여러 줄로 쓴 글이 편집기에서 한 줄로 붙어 버린다.
- 그 변환을 공용 `toPostEditorMarkdown()`에 넣지 마라. `sanitizePostMarkdown()`과 `toPostRenderMarkdown()`이 같은 함수를 쓰고 있어서 정화 결과와 읽기 화면까지 함께 바뀐다.
- 돌아오는 쪽은 `fromPostEditorMarkdown()`이 문단 사이를 줄바꿈 하나로 줄이므로 왕복이 맞는다.
- 게시물에는 수정 표시를 두지 않는다. `PostEditedMark`는 댓글 전용이다.

## 카운트

- `posts.comment_count`는 트리거가 유지하는 비정규화 값이며 삭제되지 않은 댓글만 센다. 목록 화면이 게시물마다 댓글을 세지 않게 하려는 것이다.
- 이 컬럼을 노출하는 `list_group_posts`와 `get_group_post`는 반환 모양이 바뀌면 `drop function` 후 다시 만들어야 하고, 그때 grant를 다시 발급해야 한다. pgTAP이 `has_function_privilege`로 지킨다.
- 검색 결과에는 댓글 수를 표시하지 않으므로 `search_group_posts`는 이 컬럼을 반환하지 않는다. 그래서 `GroupPostSearchResult`는 `GroupPost`와 다른 타입에서 파생한다.

## 화면 갱신

- 댓글 뮤테이션은 route를 재검증하지 않는다. 재검증하면 펼쳐 둔 답글 묶음과 위로 불러온 이전 페이지가 통째로 초기화된다. RPC가 돌려주는 정본 행을 `hooks/use-post-comments.ts`에서 병합한다.
- 게시물 목록 카드의 댓글 수는 다음 이동이나 재검증까지 낡은 값으로 남는다. 알고 두는 것이지 버그가 아니다.

## 반응

- `public.post_reactions`와 `public.comment_reactions`에도 grant를 주지 않는다. 반응 행은 통째로 신원이라(누가·무엇을·언제) 표현용으로 떼어 낼 값이 없고, 직접 select를 열면 익명 반응자의 `profile_id`가 그대로 읽힌다. 게시물·댓글처럼 `private` 테이블로 쪼개지 않은 이유도 같다 — 나눌 표현값이 없다.
- 익명 여부는 쓰는 시점의 그룹 정책으로 정해 `is_anonymous`에 박는다. 읽을 때 정책을 다시 보지 마라. 그룹이 익명 해제로 바뀌는 순간 익명을 약속받고 눌렀던 과거 반응까지 실명으로 드러난다(기능 명세 §10.4).
- 반응 수와 상위 반응은 비정규화하지 않는다. `comment_count`와 달리 상위 반응 배열은 트리거로 유지하기 까다롭고(반응 변경 한 번이 두 종류의 순위를 동시에 흔든다), 읽기 RPC의 lateral 집계가 `(post_id, reaction)` 인덱스를 탄다.
- 상위 반응은 최대 3종이고 같은 수일 때 enum 순서로 가른다. `model/reactions.ts`의 `REACTION_TYPES` 순서를 `public.post_reaction` enum과 맞춰 두어라. 어긋나면 화면과 서버의 "많이 쓰인 순"이 달라진다.
- 반응 컬럼을 읽기 RPC에 더하면 반환 모양이 바뀐다. `drop function` 후 다시 만들고 grant를 재발급해야 하며, 댓글 쪽은 `private.read_post_comments` 하나만 고치면 네 개의 공개 RPC가 따라온다. pgTAP이 `has_function_privilege`로 지킨다.
- 화면은 누르는 즉시 로컬 계산으로 앞서 나가고 RPC의 정본으로 덮는다. **상위 반응은 로컬에서 계산하지 마라** — 내 반응 하나로는 남들의 순위를 알 수 없다. `applyReactionLocally()`가 내 반응과 총계만 건드리는 이유다.
- 반응 그래픽은 `public/twemoji/15.1.0/<codepoint>.svg`에 담아 둔 Twemoji다. 외부 CDN에서 실행 시점에 받지 않는다 — 서비스 워커가 `public/`을 함께 프리캐시하므로 오프라인에서도 반응이 보인다. 본문과 댓글 텍스트는 여전히 기기 이모지 그대로다.
- `list_post_reactors`는 답글 묶음과 같은 이유로 페이지를 자르지 않는다. 자르면 목록에 보이는 수와 요약의 총계가 어긋난다.
- 댓글 요약은 가장 많이 쓰인 한 종류와 총 개수만, 그리고 반응 버튼과 **반대쪽 끝**에 둔다. 나란히 두면 내가 고른 이모지와 남들의 이모지가 맞붙어 어느 쪽이 내 것인지 읽히지 않는다. 요약을 오른쪽 끝으로 밀려면 댓글 본문 칸이 `flex-1`이어야 한다 — 말풍선은 `w-fit`이라 늘어나지 않는다.
- 목록 화면의 행에서는 반응을 남길 수 없다. 행 전체가 하나의 링크다.
- 답글의 `@작성자` 칩은 부모가 삭제돼도 남긴다. 지우면 답글이 갑자기 최상위 댓글처럼 보여 엉뚱한 사람에게 한 말로 읽힌다. 부모의 본문은 tombstone이 가리지만 이름은 그 댓글이 살아 있는 동안 이미 보이던 것이다.
