# posts feature

그룹 게시물과 개인 게시물, 그리고 둘의 댓글·반응·첨부를 소유한다. 기능 요구는
`docs/functional-spec/03-posts-and-interactions.md`(게시물)와 `04-profiles.md`(타임라인),
본문 형식은 `docs/CONTENT_FORMATTING.md`에 있다. 여기에는 코드만 읽어서는 **왜 그런지** 알 수 없는
불변식만 적는다.

## 두 종류를 어디서 가르는가

한 `posts` 테이블에 `kind`로 두 종류가 산다. 공유할지 가를지는 코드 길이가 아니라 **권한 경계와
반환 모양이 실제로 갈라지는가**로 정한다.

- 게시물 자체의 읽기·쓰기 RPC는 갈랐다(`list_group_posts` ↔ `list_profile_posts`). 그룹은
  제목·카테고리·고정·`can_pin`, 개인은 타임라인 당사자·공개 범위다. 한 반환 모양에 합치면 절반이
  항상 null인 컬럼이 되고, 컬럼이 늘면 `drop`+재생성+grant 재발급까지 끌려온다.
- 댓글·반응·첨부 RPC는 `post_id` 하나로 키가 잡혀 있어 그대로 함께 쓴다. 댓글 트리(tombstone,
  깊이, 답글 수, 익명 번호)를 종류마다 복사하면 한쪽만 고쳐졌을 때 조용히 갈라진다.
- 첨부 RPC 중 `prepare_post_attachment` 하나만 `kind = 'group'`에 묶여 있어서, 개인 게시물의
  첨부가 파이프라인 첫 단계에서 통째로 죽어 있던 적이 있다. **읽기 정책만 검증하면 잡히지
  않는다** — pgTAP이 `post_attachments` 행을 직접 넣고 RLS만 확인해서 쓰기가 막힌 채로 초록불이
  켜졌다. 첨부를 건드리면 준비→업로드→finalize→commit을 실제로 밟는 테스트를 남겨라.
- 갈라진 쪽도 몸통은 `private.apply_post_commit()`을 공유한다. 첨부의 소유권·중복·업로드
  메타데이터 검증과 순서 재배치는 종류와 무관하다.

## 개인 게시물

- `private.can_read_post()`가 세 갈래 읽기 권한(그룹 멤버 / 전체 공개 / 작성자 전용)의 **유일한**
  판정이다. RLS, Storage 정책, 반응 컨텍스트, 댓글 컨텍스트가 모두 이 하나를 부른다. 인라인으로
  복제하면 첨부는 보이는데 본문은 안 보이는 식으로 어긋난다.
- 공개 범위는 게시 후에도 바뀐다(기능 명세 §8.10). 그래서 `visibility`는 불변 트리거에서 조건부로
  풀려 있고, `commit_profile_post`가 세우는 `app.commit_post` 안에서만 열린다. 게시 전환 규칙에는
  같은 플래그를 걸지 마라 — 플래그를 세우지 않는 `publish_group_post`가 함께 막힌다.
- 타인 타임라인 글은 언제나 전체 공개다. 서버가 `p_visibility`를 무시하고 `public`으로 되돌리므로
  클라이언트의 선택 UI는 자기 타임라인에서만 그린다.
- 타인 작성 허용은 **게시하는 순간**의 값으로 다시 본다. 초안은 새 글이지만, 이미 게시된 글의 수정은
  막지 않는다 — 허용을 꺼도 기존 글은 유지한다(기능 명세 §8.4).
- 타임라인 당사자는 타인의 글을 **지울 수는 있어도 고칠 수는 없다**(기능 명세 §12.4). `can_edit`과
  `can_delete`가 개인 게시물에서 갈라지는 유일한 이유다.
- `private.read_post_comments()`의 `p_caller_role`은 개인 게시물에서 null이다. `false or null`이
  null이라 `can_delete`가 boolean이 아닌 null로 샜었다 — `coalesce`로 막아 두었으니 되돌리지 마라.
  그룹에서는 비멤버가 그 코드까지 도달하지 못해 드러나지 않던 구멍이다.
- 타임라인 RPC는 프로필 숫자 ID가 아니라 화면과 같은 공개 ID를 받는다. loader가 프로필을 먼저
  기다렸다가 그 ID로 게시물을 부르면 화면 하나에 종속 왕복이 쌓인다.
- 타임라인 당사자 join은 **inner join에 `status = 'accepted'`**다. 작성자 쪽처럼 left join으로
  null을 떨어뜨리면 주인 없는 타임라인의 글이 직접 링크로 열린다.
- 공개 범위만 바꾼 커밋은 `edited_at`을 건드리지 않는다. 무엇이 바뀌었는지는 커밋 전의 `ready`
  첨부 집합과 비교해 정한다 — 게시된 글에서 `finalize_post_attachment`는 새 첨부를 `pending`으로
  남기므로 `ready`가 곧 편집 전 상태다. `status <> 'deleted'`로 세면 방금 올린 첨부까지 들어가
  사진만 더한 수정이 수정이 아닌 것이 된다.
- 프로필 사진·커버 등록과 변경은 자기 타임라인의 전체 공개 개인 활동 게시물을 만든다. 활동은
  `activity_kind`와 변경 당시 `profile-media` 경로를 가지며 본문·일반 첨부·수정을 허용하지 않는다.
  댓글·반응·공유·삭제는 일반 개인 게시물 경로를 그대로 쓴다.

## route는 부모가 읽은 것을 다시 읽지 않는다

게시물 작성·수정 화면은 그룹/프로필 route의 자식이라 부모 loader가 언제나 먼저 돈다. 그룹과
타임라인 당사자, 카테고리는 그 데이터에 이미 들어 있으므로 자식 loader에서 다시 읽지 마라 —
글쓰기를 누를 때마다 같은 조회가 두 번 나가고, 카테고리처럼 부모를 기다려야 하는 값은 왕복이
줄줄이 붙는다. `post-edit`가 게시물 자체를 읽는 것은 부모에 없기 때문이지 예외가 아니다.

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

## 화면 공유

- 상세 모달의 껍데기(머리, 스크롤 영역, 액션 바, 댓글 목록, 입력창)는 `PostDetailDialog` 하나다. 카드 댓글 링크의 `view=comments`는 모바일에서 같은 껍데기를 98svh 하단 댓글 시트로 바꾸며, 별도 댓글 상태를 만들지 않는다.
  두 종류가 다른 것은 본문 영역뿐이다. 액션 바까지 껍데기가 그리는 이유는 그것이 방금 쓴 댓글을
  더한 개수와 입력창 포커스를 필요로 하는데, 둘 다 껍데기만 알기 때문이다.
- `PostMenu`의 고정 관련 props는 선택이다. 개인 게시물은 넘기지 않고, 그러면 항목 자체가 사라진다.
- 개인 게시물 댓글의 신원 선택지는 `["identified"]` 하나다. `CommentComposer`가 길이 1일 때 신원
  전환 버튼을 그리지 않으므로 별도 분기가 없다.

## 화면 갱신

- 댓글·반응 뮤테이션은 route를 재검증하지 않는다. 재검증하면 펼쳐 둔 답글 묶음과 위로 불러온 이전 페이지가 통째로 초기화된다. RPC가 돌려주는 정본 행을 병합한다(`hooks/use-post-comments.ts`).
- 반응은 누르는 즉시 로컬 계산으로 앞서 나가고 정본으로 덮는다. **상위 반응은 로컬에서 계산하지 마라** — 내 반응 하나로는 남들의 순위를 알 수 없다. `applyReactionLocally()`가 내 반응과 총계만 건드리는 이유다.
- 목록 카드의 댓글 수는 다음 이동이나 재검증까지 낡은 값으로 남는다. 알고 두는 것이지 버그가 아니다.

## 그 밖에

- 댓글 본문은 평문이다. 게시물의 Markdown 파이프라인(`model/markdown.ts`)을 타지 않는다.
- 줄바꿈 하나를 문단으로 가르는 `toMilkdownMarkdown()`은 편집기에 넣을 때만 쓴다. 이 변환을 공용 `toPostEditorMarkdown()`에 옮기지 마라 — `sanitizePostMarkdown()`과 `toPostRenderMarkdown()`이 같은 함수를 써서 정화 결과와 읽기 화면까지 함께 바뀐다.
- `model/reactions.ts`의 `REACTION_TYPES` 순서를 `public.post_reaction` enum과 맞춰 두어라. 서버가 같은 수의 상위 반응을 enum 순서로 가르므로, 어긋나면 화면과 서버의 "많이 쓰인 순"이 달라진다.
- 반응 그래픽은 `public/twemoji/15.1.0/<codepoint>.svg`에 담아 둔 Twemoji다. 서비스 워커가 `public/`을 프리캐시하므로 오프라인에서도 보인다. 실행 시점에 CDN에서 받지 마라.
