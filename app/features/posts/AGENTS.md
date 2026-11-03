# posts feature

그룹 게시물과 개인 게시물, 그리고 둘의 댓글·반응·첨부를 소유한다. 기능 요구는
`docs/functional-spec/posts.md`(게시물)와 `profiles.md`(타임라인),
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
  같은 플래그를 걸지 마라 — 플래그를 세우지 않는 게시 경로가 함께 막힌다.
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
- 아바타 변경은 작은 프로필 슬롯용 512px object와 활동 게시물용 2048px object를 함께 준비한다.
  finalize는 둘을 모두 검증한 뒤 활동 게시물이 고화질 경로를 가리키게 한다. 커버는 기존 2400px
  object 하나를 슬롯과 활동이 함께 쓴다.

## 고정

- 고정(`pinned_at`)은 목록 순서를 바꾸지 않는다. 일반 목록은 게시 시각순이고, 고정 글은 카드 보기에서
  목록 위 가로 섹션에 최근 고정한 순서로 따로 모인다(기능 명세 §8.11). 예전 "목록 맨 위에 쌓는 고정"과
  "대표 게시물"을 하나로 합쳤다 — 둘이 섞여 헷갈리고 쌓인 고정 카드가 목록 공간을 먹었다.
- 목록 보기는 가로 섹션 없이 고정 목록을 행으로 맨 위에 붙이고 시간순 자리에서 뺀다. 서버 순서가
  아니라 패널이 합친다 — 목록 RPC는 고정과 무관하게 페이지를 나누므로 순서를 바꾸면 커서가 깨진다.
- 순서가 고정 시각이라 `set_group_post_pinned`는 `now()`가 아니라 `clock_timestamp()`를 쓴다.
  `now()`는 트랜잭션 시작 시각이라 한 트랜잭션에서 두 글을 고정하면 같은 값이 되어 순서가
  tie-break(게시 시각)로 떨어진다 — pgTAP이 한 트랜잭션 안에서 이걸 잡는다.
- `list_group_pinned_posts`는 `list_group_posts(p_pinned_only => true)`를 감싸 목록 select를
  복사하지 않는다. 개수 제한이 없어 한 응답에 전부 실리므로 껍데기가 본문을 앞 500자로, 첨부를
  표지로 쓰는 첫 사진 하나로 줄인다. 열을 더할 때는 `list_group_posts`를 고치고 껍데기의
  `returns table`과 select 목록을 맞춘다. 줄인 행이라 고정 목록의 `GroupPost`를 상세·수정에 쓰지 않는다.
- 그룹 loader는 고정 목록을 첫 페이지와 함께 기다린다. 섹션이 펼친 채 목록 위에 서므로 늦게 뜨면
  읽던 목록이 밀린다. 실패는 삼키고 `GroupPostsPanel`이 `groupPinnedPostsQuery`로 다시 읽어 섹션
  자리에서 다시 시도로 알린다.
- 고정·해제는 목록 캐시의 그 글 `is_pinned`만 고치고 고정 목록을 다시 읽는다. 그룹 loader는 게시물
  고정·삭제 뒤 다시 돌지 않는다(`routes/app/groups/detail.tsx`의 `shouldRevalidate`). 신고 탭은 loader가 준
  신고 목록을 그리므로 예외다.
- 고정 섹션은 그룹에 들어올 때마다 펼쳐 시작하고 접힘을 저장하지 않는다. 접힘은 패널이 아니라
  `GroupDetailScreen`이 든다 — 패널은 탭을 오가면 다시 마운트된다.
- 홈 피드는 고정 여부를 싣지 않는다. 고정은 그룹 게시물 탭 안의 상태다.
- 고정 카드 본문은 `extractPostPreviewText()`의 평문이다. `PostMarkdown`으로 되돌리지 마라 — 크기가 다른 제목과 빈 문단에 `line-clamp`가 걸려 줄이 어긋나 잘리고, 제목 링크를 본문까지 넓힌 면 안에 본문의 링크·멘션이 겹친다. 평문에서도 멘션 이름은 토큰이 아니라 `mentions`에서 읽는다.

## route는 부모가 읽은 것을 다시 읽지 않는다

게시물 작성·수정 화면은 그룹/프로필 route의 자식이라 부모 loader가 언제나 먼저 돈다. 그룹과
타임라인 당사자, 카테고리는 그 데이터에 이미 들어 있으므로 자식 loader에서 다시 읽지 마라 —
글쓰기를 누를 때마다 같은 조회가 두 번 나가고, 카테고리처럼 부모를 기다려야 하는 값은 왕복이
줄줄이 붙는다. `post-edit`가 게시물 자체를 읽는 것은 부모에 없기 때문이지 예외가 아니다.

## 신원

- 실제 작성자는 `private.post_authors` / `private.comment_authors`에만 있다. 클라이언트 가독 행에는 표현용 값(`author_identity`, `display_author_profile_id`, `anon_alias_number`)만 둔다.
- 신원 판정의 경계는 RPC 안이다. 클라이언트의 `resolveIdentityOptions()`는 선택지를 그리기 위한 것이고, 게시물과 댓글이 같은 규칙을 쓰므로 화면마다 다시 계산하지 않는다.
- 익명 번호는 게시물 단위이며 원본은 `private.post_anonymous_aliases`에만 있다. 클라이언트에 열어 주면 번호로 같은 사용자를 여러 게시물에 걸쳐 이을 수 있다.
- `글쓴이`(alias `0`)는 **게시물 자체가 익명일 때만** 붙인다. 실명 게시물의 작성자에게 붙이면 실명과 익명 댓글이 연결돼 익명 선택이 무너진다.
- 실명·운영진 게시물의 실제 작성자는 자기 글에 익명 댓글·답글을 쓸 수 없다(기능 명세 §9.1). 이름을 걸고 쓴 글 아래의 익명은 이미 작성자라고 드러난 셈이라 익명일 이유가 없다. 익명 게시물에는 걸지 마라 — 거기서는 작성자도 `글쓴이`로 익명 참여한다. 판정은 표시 신원이 아니라 `private.post_authors`로 하고, 경계는 `public.create_post_comment` 안이다. `GroupPostDetail`이 익명 선택지를 지우는 것은 UX다.
- 그룹 익명 활동 제한은 `private.group_anonymous_activity_restrictions`에 멤버십과 별도로 남는다. 운영 RPC는 대상 프로필 ID를 받지 않고 현재 공개 중인 익명 게시물·댓글의 private author에서만 대상을 찾는다.
- 운영자용 게시물·댓글 응답은 `can_moderate_anonymous`, `anonymous_author_restricted`와 활성 제한의 만료 시각만 공개한다. 실제 작성자 ID나 제한 대상 목록을 추가하지 마라.
- 익명 게시·댓글 쓰기는 같은 그룹/대상의 advisory lock 아래 활성 제한을 검사한다. 즉시 게시, 두 초안 게시 경로와 댓글 경로 중 하나라도 빠뜨리면 제재와 작성이 경합할 때 우회된다.

## 멘션

- 게시물 본문은 화면 크기와 관계없이 Milkdown이 편집하고 같은 서식 기능을 제공한다. 모바일
  툴바는 한 줄 가로 스크롤로 공간만 조정한다. 높이는 두 화면 모두 편집기 자신이 제한하고 본문만
  내부 스크롤한다 — 모바일은 `clamp` 고정 높이, 데스크톱은 내용을 따라 자라다 상한에서 멈춘다.
  부모 화면의 flex 높이로 편집기를 누르면 첨부 수에 따라 편집기가 작아지거나 첨부가 잘린다.
  데스크톱을 고정 높이로 되돌리지도 마라 — 페이지 스크롤 안에 편집기 스크롤이 겹친다. Milkdown
  래퍼와 ProseMirror는 퍼센트가 아니라 flex로 그 상자를 채운다(`app.css`). 높이가 확정되지 않는
  데스크톱에서 백분율이 풀리면 클릭·캐럿이 닿는 면이 보이는 상자보다 작아진다. 모바일 전용 Markdown `textarea`를 다시 두면 같은 초안과 멘션 커서를 두
  편집기 사이에서 맞춰야 하므로 분기하지 마라.
- 본문에 남는 것은 `[@표시이름](m:<ordinal>)` 토큰뿐이고 실제 대상은 `public.post_mentions` /
  `public.comment_mentions`에 있다. 본문에 `pub_id`를 박지 마라 — 공개 ID는 바뀌고 놓아준 값을
  남이 다시 쓸 수 있어서(기능 명세 §12.2) 오래된 멘션이 조용히 다른 사람을 가리킨다. ordinal은
  그 본문 안에서만 뜻이 있어 내부 프로필 ID도 새지 않는다.
- 댓글 입력창은 `textarea`라 글자 일부만 달리 그릴 수 없다. 그래서 입력창이 드는 값은 원문이
  아니라 표시형(`@이름`)이고, `fromMentionDisplay()`가 제출 직전에 토큰으로 되돌린다. 길이
  상한·멘션 수·번호 배정은 전부 되돌린 원문으로 계산해라 — 표시형으로 세면 토큰 길이만큼
  넘겨 보내고, `nextMentionOrdinal()`은 토큰이 없는 글에서 언제나 1을 준다.
- 되돌릴 자리는 이름이 아니라 버튼이 남긴 보이지 않는 표시(`MENTION_DISPLAY_MARKS`)로 찾는다.
  이름만 보고 짝을 지으면 세 가지가 한꺼번에 어긋난다: 골랐다가 지운 사람의 이름을 손으로 친
  글이 멘션이 되고, 탈퇴한 대상의 라벨이 같은 이름의 활성 대상에게 붙고, 동명이인 둘 중 하나를
  지우면 남은 쪽이 먼저 고른 사람을 부른다. 셋 다 부른 적 없는 사람에게 알림이 가는 길이다.
- 어느 표시를 쓸지는 `mentionDisplaySlot()`이 **ordinal만 보고** 정한다. 초안의 다른 항목을
  세지 마라 — `register()`는 본문에서 사라진 ordinal을 재사용하며 그 항목을 버리고, 그 순간
  이미 써 놓은 표시들이 한 칸씩 밀려 옆 사람을 가리킨다. 짝이 없는 표시는 옆 사람에게 넘기지
  않고 평문으로 둔다.
- 표시가 떨어져 나간 자리는 평문이 된다. 엉뚱한 사람을 부르는 것보다 안 부르는 쪽이 낫다.
  짝 없는 표시는 제출 전에 지워 보이지 않는 글자가 저장되지 않게 한다.
- 멘션은 한 덩어리로 지운다. 댓글 입력창과 본문 편집기가 같은 규칙을 쓴다: `beforeinput`의 삭제가
  멘션 자리에 닿으면 `expandDeletionOverMentions()`가 그 자리 전체로 넓힌다. 다른 것은 자리를 찾는
  방법뿐이다 — 댓글은 `mentionDisplayRanges()`, 본문은 `m:` link mark. 반쪽이 남으면 댓글은 멘션이
  아닌 글자가 되고, 본문은 반쪽 링크도 멘션이라 `normalizeMentions()`가 이름을 되살려 지운 줄 아는
  사람을 부른다. keydown으로 되돌리지 마라 — 모바일 키보드는 Backspace를 keyCode 229로 보낸다.
  `textarea`는 지울 범위를 미리 알려 주지 않아, 캐럿만 둔 단어·줄 삭제는 브라우저가 지운 뒤
  `removedRange()`로 지운 자리를 찾아 넓힌다.
- 다른 편집기에서 붙여 넣은 `m:` 링크는 평문 `@이름`으로 푼다. ordinal은 그 글의 번호표 안에서만 뜻이
  있어, 그대로 받으면 이 글의 같은 번호 대상을 부른다. 같은 편집기에서 온 것인지는 복사할 때 link
  `title`에 실은 편집기 표식으로 가린다(`pastedMentions`).
- 편집마다 `sanitizeMentionDisplay()`로 짝 잃은 표시를 걷되, 한글 조합 중에는 미루고
  `compositionend`에서 한 번 정리한다. 조합 중에 값과 캐럿을 건드리면 쓰던 글자가 끊긴다. 남겨 두면 깨진 이름을 원래대로
  다시 쳤을 때 멘션이 조용히 되살아난다 — 평범한 글자를 쓴 줄 아는 사람이 알림을 보낸다.
  값과 캐럿을 함께 바꿔야 한다. React가 값을 다시 심으면 캐럿이 끝으로 튄다.
- 토큰이 CommonMark 링크 모양인 것은 편집기 때문이다. Milkdown이 커스텀 노드 없이 링크로 그려
  주고 remark 왕복도 그대로 통과한다. 대신 `sanitizePostMarkdown()`의 링크 허용과
  `PostMarkdown`의 `urlTransform`이 `m:` 하나를 함께 열어 줘야 한다 — 둘 중 하나만 빠뜨리면
  정화가 링크를 풀어 멘션이 평문이 된다.
- 밑줄(`:u[…]`) 직렬화에 `remark-directive`를 그대로 붙이지 마라. 그 직렬화 규칙은 글자 앞
  `:`를 모두 escape해서 저장된 토큰이 `[@이름](m\:1)`이 되고, `private.parse_mention_ordinals()`의
  정규식이 멘션을 놓쳐 알림과 대상이 사라진다. `model/underline.ts`가 파싱만 빌리고 escape는
  `:u[` 하나로 좁혔다.
- **수신자는 클라이언트가 준 목록이 아니라 본문에서 파생한다.** `private.sync_post_mentions()`가
  본문을 정규식으로 훑어 ordinal을 뽑고 그 자리의 `pub_id`만 해석한다. 목록을 그대로 믿으면
  본문에 없는 사람에게 알림을 보내게 할 수 있다.
- 본문을 쓰는 경로는 전부 sync를 지나야 한다: `create_group_post`, `commit_group_post`,
  `create_post_comment`, `update_post_comment`. 한때 `update_group_post`가 같은 일을 하면서 sync를
  지나지 않아 함께 지웠다 — 본문 쓰기 경로를 새로 만들면 여기도 늘려라.
- 수정은 행을 통째로 지우고 다시 넣는다. "제거 후 재추가에는 재알림 없음"(기능 명세 §8.14)과
  "새로 추가된 대상에게만 알림"이 둘 다 `emit_notification`의 event key에서 나오므로, 여기서
  차이를 계산하지 마라.
- 알림은 두 곳에서 낸다. `post_mentions`의 INSERT 트리거는 이미 게시된 글을, `notify_post_published`는
  초안이 게시되는 순간을 맡는다. 초안 커밋에서 둘이 겹칠 수 있지만 event key가 흡수한다. 한쪽만
  두면 멘션 행 INSERT 시점과 게시 시점이 어긋나는 초안에서 알림이 빠진다.
- 익명은 막고 운영진 명의는 연다. 운영진 명의 글은 실제 작성자의 이름과 사진을 그대로 보여주므로
  (기능 명세 §8.6) 익명 뒤에 숨는 지목이 아니다. 초안의 신원 전환(`update_group_post_draft_identity`)도
  같은 이유로 멘션이 남아 있으면 거절한다 — 안 막으면 익명 금지가 통째로 우회된다.
- 후보 검색은 `search_group_mention_candidates`다. 명부(`list_group_members`)와 정렬이 다르다 —
  명부는 그룹 역할 순이고 여기는 선생님 먼저, 그다음 최근 기수 순이다. 명부에 정렬 인자를 얹지 말고
  이 함수를 써라.
- 화면의 이름은 읽기 RPC의 `mentions`에서 온다. 토큰 안의 이름은 원문을 읽을 때를 위한
  장식이므로 렌더러가 그것을 쓰면 개명이 반영되지 않는다. 예외는 게시물 검색 결과 하나다 —
  `search_group_posts`는 `mentions`를 돌려주지 않고 요약이 `extractPostPlainText()`로 만든
  평문이라(기능 명세 §8.9) 토큰에 적힌 이름이 그대로 보인다. 요약 한 줄에 개명이 늦게 따라오는
  것을 받아들인 것이지, 다른 화면도 그래도 된다는 뜻이 아니다.
- 이미 불린 사람에게는 멤버십을 다시 묻지 않는다. 편집마다 다시 물으면 멘션된 멤버가 그룹을
  나간 뒤로 그 글이 영구히 저장 불가가 된다 — 제목 오타 하나도 못 고치고 작성자가 본문에서
  토큰을 손으로 찾아 지워야 한다. `already_mentioned`로 기존 대상을 통과시키고 **새로 부르는
  사람에게만** 멤버십을 요구한다.
- 표시형 `textarea`의 편집 규칙(한 덩어리 삭제, 짝 잃은 표시 정리, 캐럿 유지, 조합 중 보류)은
  `hooks/use-mention-textarea.ts` 하나다. 댓글 입력창과 메시지 작성창(`messaging`)이 함께 쓴다 — 한쪽
  입력창에 따로 고치면 두 입력창의 멘션 규칙이 갈라진다.
- `EVERYONE_MENTION_ORDINAL`(0)은 메시지의 `@모든 사람`이다(기능 명세 §13.22). `normalizeMentions()`가
  번호를 다시 매기지 않고 대상 목록에도 넣지 않는다. 게시물·댓글 서버는 0번을 짝 없는 번호로
  거절하므로 게시물 편집기와 댓글 입력창에서는 만들지 마라.
- 멘션 상한은 서로 다른 대상 50명이다. 같은 사람을 여러 번 부르는 것은 한 명으로 세므로 상한에
  닿아도 이미 본문에 남아 있는 대상은 후보 목록에서 다시 고를 수 있어야 한다.

## 첨부의 수명주기

- 읽기용 분류·다운로드 도우미는 `model/attachments.ts`, 업로드 준비·해제는
  `model/attachment-preparation.ts`에 둔다. 읽기용 모듈에서 준비 모듈을 재수출하면 피드가 이미지 압축·업로드 검증 코드를 다시 초기 의존성으로 받는다.
- 홈 피드는 미디어 서명 전에 본문을 표시하므로 카드를 `MediaPendingContext`로 감싼다. URL이 없는 미디어
  자리의 문구는 `useUnavailableMediaLabel()`로만 정한다 — 새 미디어 표면도 이 hook을 쓰면 로딩과 실패가
  자동으로 갈린다. 다른 화면은 감싸지 않아 기존 실패 표현을 유지하며, 로딩과 완료의 이미지 비율·테두리를
  같게 유지한다.

첨부 하나가 다섯 곳에서 동시에 상태를 갖는다. 한 곳만 보고 고치면 나머지가 조용히 어긋난다.

| 층                              | 상태                                                                                   | 옮기는 곳                                                  |
| ------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 클라이언트 세션                 | `status`(queued → uploading → ready 또는 error) + `uploaded` / `finalized` / `removed` | `runPostFileUpload()`                                      |
| Storage                         | 원본 object, 축소본 object(없을 수 있다)                                               | 브라우저 업로드                                            |
| `post_attachments`              | `pending` → `ready` → `deleted`                                                        | `finalize_post_attachment`, `private.apply_post_commit`    |
| 부모 `posts.published_at`       | null(초안) / 값(게시됨)                                                                | `commit_group_post`, `commit_profile_post`                 |
| `private.storage_cleanup_queue` | 지울 경로                                                                              | `apply_post_commit`, `purge_posts`, finalize의 축소본 반려 |

- **축소본은 finalize보다 먼저 올려라.** `finalize_post_attachment`가 축소본 object의 존재·타입·크기를
  확인하고, 미달이면 실패시키는 대신 `thumbnail_path`를 지워 원본으로 떨어뜨린다. 순서를 뒤집어도
  아무것도 던지지 않고 화면도 멀쩡하다 — 축소본만 영영 안 생긴다. 계층을 넘는 순서 규칙이라
  타입으로도 제약으로도 잡히지 않으니 손대면 직접 확인해라.
- **`finalize_post_attachment`는 게시 여부에 따라 다른 함수다.** 미게시 초안이면 `ready`로 올리고,
  이미 게시된 글이면 `pending`으로 남긴다. 그래야 커밋이 "이번 편집 전부터 있던 첨부"를 `ready` 하나로
  구분할 수 있다.
- 그 구분 위에 두 커밋 RPC의 `content_changed`가 서 있다. `ready`만 세어 원래 순서를 재고 그 값으로
  `edited_at`을 찍는다. `status <> 'deleted'`로 세면 방금 올린 첨부까지 들어가 양쪽 배열이 같아지고,
  사진만 더한 수정이 수정이 아닌 것이 된다. 반드시 `apply_post_commit` **앞에서** 재라 — 그 함수가
  position과 status를 갈아엎는다.
- **수정으로 치지 않는 것**: 그룹은 카테고리 이동, 개인은 공개 범위 변경. 제목·본문·첨부 구성만
  `edited_at`을 움직인다. 둘 중 한쪽만 고치면 같은 규칙이 종류마다 달라진다.
- 업로드가 던졌는데 finalize가 통과하면 성공으로 친다. finalize가 `storage.objects`를 대조하므로
  통과했다는 것은 object가 실제로 올라갔다는 뜻이고, 응답만 잃은 경우를 여기서 건진다. 버그로 보고
  지우면 재시도마다 중복 업로드가 난다.
- 세션 상태에는 통지 경로가 둘이다. `updatePostUpload()`는 리스너에 알리지만
  `state.uploaded` / `finalized` / `attachment` / `removed` 직접 대입은 알리지 않는다. 지금은 화면이
  그 필드를 읽지 않아 무해하다. 읽게 만들 거라면 먼저 대입을 `updatePostUpload()`로 모아라.

## 직접 접근을 막은 테이블

`post_comments`, `comment_images`, `post_reactions`, `comment_reactions`에는 select grant조차 주지 않는다. 읽기도 쓰기도 definer RPC를 거친다.

- 댓글은 직접 select를 열면 tombstone 판정을 건너뛰고 삭제된 본문이 읽힌다.
- 댓글 이미지는 공개 메타데이터와 `private.comment_image_uploaders`의 업로더를 분리한다. finalize는
  아직 댓글에 붙이지 않으며, `create_post_comment` / `update_post_comment`가 같은 트랜잭션에서
  claim해 `ready`로 바꾼 뒤에만 `list_comment_images`와 Storage 서명이 열린다.
- 반응 행에는 누가·무엇을·언제 눌렀는지가 함께 있으므로 클라이언트가 직접 읽지 않고, 접근 권한을 확인하는 반응자 목록 RPC로만 공개한다.
- `depth`와 `root_comment_id`가 실제 부모와 맞는지는 CHECK로 표현할 수 없다. 쓰기 경로가 `create_post_comment` 하나라는 전제 위에 서 있으므로 다른 insert 경로를 만들지 마라.

## tombstone

- 저장 상태가 아니라 읽기 시 판정이다: **삭제된 댓글은 살아 있는 자손이 하나라도 있을 때만 보인다.** 최상위 삭제(같은 `root_comment_id` 전체에 `deleted_at`을 찍으므로 자손이 남지 않는다)와 중간 삭제가 이 한 줄로 모두 설명된다. 클라이언트에서 흉내 내지 말고 답글 묶음을 다시 읽어라.
- 답글의 `@작성자` 칩은 부모가 삭제돼도 남긴다. 지우면 답글이 갑자기 최상위 댓글처럼 보여 엉뚱한 사람에게 한 말로 읽힌다. 화면이 부모의 삭제 여부로 갈라질 일이 없으므로 응답에도 그 값을 넣지 않는다.

## 읽기 RPC의 반환 모양

컬럼을 더하거나 빼면 `create or replace`가 통하지 않는다. `drop function` 후 다시 만들고 **grant를 재발급해야 한다** — 빠뜨리면 런타임에서 42501로 터진다. pgTAP의 `has_function_privilege`가 지킨다. 댓글 쪽은 `private.read_post_comments` 하나를 고치면 네 개의 공개 RPC가 모양만 따라 바뀐다.

- `posts.comment_count`는 트리거가 유지하는 비정규화 값이며 삭제되지 않은 댓글만 센다. 목록 화면이 게시물마다 댓글을 세지 않게 하려는 것이다.
- 반응 수와 상위 반응은 비정규화하지 않는다. 반응 변경 한 번이 두 종류의 순위를 동시에 흔들어 트리거로 유지하기 까다롭고, 읽기 RPC의 lateral 집계가 `(post_id, reaction)` 인덱스를 탄다.
- `search_group_posts`는 댓글 수를 반환하지 않는다(검색 결과에 표시하지 않는다). 그래서 `GroupPostSearchResult`는 `GroupPost`가 아니라 검색 RPC에서 파생한다.

## components 폴더

이 기능만 `components/` 아래를 나눈다. 다른 기능은 평평하게 두고, 여기만 파일이 40개를 넘어
알파벳순 목록에서 무엇이 무엇의 부품인지 읽히지 않게 됐다.

- `comment/`, `reaction/`, `group/`, `profile/`, `editor/`에 각각 그 묶음에서만 쓰는 것을 둔다.
- 루트에 남은 것은 **그룹과 개인 양쪽이 함께 쓰는 것**뿐이다(`post-detail-dialog`,
  `post-action-bar`, `post-attachments`, `post-author-avatar`, `post-body-clamp`,
  `post-markdown`, `post-menu`, `post-write-row`). 한쪽만 쓰게 되면 그 폴더로 내려보내라 —
  루트에 있다는 것이 곧 "둘 다 쓴다"는 뜻이어야 판단이 서 있다.
- 파일 이름은 폴더 안에서도 줄이지 않는다(`group/group-post-card.tsx`). 컴포넌트 이름과
  파일 이름이 1:1이라야 `test/`의 같은 이름 파일과 짝이 유지된다.

`GroupPostDetail`은 같은 이름의 모델 타입과 다투므로 제 파일 안에서 타입을
`GroupPostDetailModel`로 alias한다. 배럴은 컴포넌트 쪽 이름을 내보낸다.

## 화면 공유

- 상세 모달의 껍데기(머리, 스크롤 영역, 액션 바, 댓글 목록, 입력창)는 `PostDetailDialog` 하나다. 카드 댓글 링크의 `view=comments`는 화면 폭이 1024px 이하이고 터치가 주 입력인 환경에서 같은 껍데기를 98svh 하단 댓글 시트로 바꾸며, 별도 댓글 상태를 만들지 않는다. 모바일은 전체 폭을 쓰고 태블릿은 최대 2xl 폭으로 가로 중앙에 둔다.
  모바일 iOS에서만 키보드가 뜨면 팝업을 visual viewport의 `offsetTop`과 `height`로 보이는 영역에 맞춘다. Android에서는 키보드 훅을 끄고 `interactive-widget=resizes-content`에 따른 브라우저의 기본 레이아웃을 사용한다. `bottomInset`·높이·위치 보정을 중복 적용하지 않는다. iOS 보정을 Android에도 적용하면 키보드에 맞춘 레이아웃에 높이 보정이 겹칠 수 있다. 제목으로 연 상세와 댓글 전용 시트 모두 같은 입력창 focus capture를 쓰므로 직접 탭·댓글 버튼·답글 버튼에 같은 처리가 적용된다. iOS에서 답글 대상 줄을 먼저 동기 반영하고 같은 탭 이벤트 안에서 입력창에 포커스를 준다. 위치를 보정하는 모바일 iOS(확대 배율 1)는 `preventScroll`을 줘도 화면을 밀 수 있어 포커스 순간 한 프레임만 입력창의 opacity를 0으로 두고 복원한다. 넓은 iPad·핀치 확대·visual viewport 미지원·Android 환경에서는 이 처리를 하지 않고 기본 포커스 스크롤을 유지한다. 답글 대상을 보여 주는 스크롤은 댓글 목록 안에서만 한다.
  두 종류가 다른 것은 본문 영역뿐이다. 액션 바까지 껍데기가 그리는 이유는 그것이 방금 쓴 댓글을
  더한 개수와 입력창 포커스를 필요로 하는데, 둘 다 껍데기만 알기 때문이다.
- 끌어서 닫는 하단 시트의 자리와 손짓은 `hooks/use-sheet-drag.ts` 하나다. 댓글 시트와 반응 목록이 함께 쓴다 — 한쪽만 고치면 닫히는 거리와 스크롤 경계가 갈라진다. `ReactionListDialog`는 카드와 댓글마다 달려 있어 처음 열 때 만든다. 미리 두면 닫힌 목록의 `matchMedia` 구독이 그 수만큼 쌓인다.
- 껍데기에 갈아 끼우는 본문은 `GroupPostDetail`과 `ProfilePostDetail`이고, 편집기도 같은 짝
  (`GroupPostEditor` / `ProfilePostEditor`)이다. 한때 그룹 쪽 셋을 `mode` prop 하나로 받던
  `GroupPostOverlay`가 있었으나 없앴다 — 호출부가 모두 `mode`를 리터럴로 넘기면서 절반의
  모드에서만 쓰는 optional prop만 쌓였고, 상세가 쓰지도 않는 `groupName`/`groupId`를 피드
  loader가 계속 실어 날랐다.
- `GroupPostDetail`의 머리에 있는 "<그룹 이름> 그룹으로 이동" 링크는 장식이 아니다. 알림과
  피드에서 들어온 사용자의 뒤로가기는 그가 온 곳으로 돌아가므로(`routes/notification-open.tsx`),
  이 링크가 게시물에서 그룹으로 가는 유일한 길이다. 상세 RPC는 그룹 이름을 돌려주지 않아
  `groupName`을 화면에서 받는다 — 그룹 route는 부모 loader, 피드는 `FeedPostDetail`이 들고 온다.
- 그룹 안에서 연 게시물에서는 그 링크를 감춘다. 브라우저가 이전 history entry를 알려주지 않아
  **그룹 안쪽 링크가 `FROM_GROUP` 표식을 심고**(`model/navigation.ts`) 상세가 그것을 읽는다.
  방향을 뒤집어 알림·피드 쪽에 심지 마라 — 표식을 빠뜨렸을 때 링크가 꼭 필요한 화면에서
  사라진다. 지금 방향의 실수는 링크가 한 번 더 보이는 것으로 끝난다. 그룹 안에서 상세로 가는
  링크를 새로 만들면 표식도 같이 심어라.
- `PostMenu`의 고정 관련 props는 선택이다. 개인 게시물은 넘기지 않고, 그러면 항목 자체가 사라진다.
- 개인 게시물 댓글의 신원 선택지는 `["identified"]` 하나다. `CommentComposer`가 길이 1일 때 신원
  전환 버튼을 그리지 않으므로 별도 분기가 없다.

## 화면 갱신

- 일반적인 탭·창 복귀는 그룹 접근 상태만 확인하고, 권한이 같으면 게시물 목록을 재검증하지 않는다. 누적 페이지·카테고리·스크롤을 보존해야 하므로 게시물 캐시의 신선도와 복귀 권한 확인을 묶지 마라(`docs/DATA_CACHE_POLICY.md`).
- 그룹 게시물 목록은 카테고리마다 무한 쿼리 하나(`groupPostsQuery`)이고, 화면은 그 캐시만 그린다. 첫 페이지를 loader 데이터에, 이어 받은 페이지를 컴포넌트 state에 나눠 두면 재검증이 새 첫 페이지를 줄 때마다 쌓은 페이지와 카테고리를 버려야 한다 — 그 구조로 되돌리지 마라.
- 그룹 목록은 마운트·포커스로 다시 읽지 않는다. 무한 쿼리를 그냥 refetch하면 쌓인 페이지를 전부 차례로 다시 받으므로, 낡은 목록은 `fetchGroupPosts`가 첫 페이지로 줄여 한 번만 받고, 실패하면 줄이기 전 페이지를 돌려놓는다(loader와 카테고리 전환). loader는 전체 목록만 받으므로 그 첫 페이지가 바뀌면 패널이 보고 있는 카테고리 목록도 같은 방식으로 다시 받는다. 고정·삭제는 다시 받지 않고 `setGroupPostPinnedInLists`·`removeGroupPostFromLists`로 고치며, 고친 캐시는 받은 시각과 무효화 표시를 그대로 둔다.
- 목록 보기로 받은 페이지는 `mediaHydrated: false`다. 카드 보기에서 패널이 그 페이지를 서명하고, 서명 중 페이지 객체가 바뀌었으면 결과를 버린다.
- 프로필 목록의 다음 페이지 요청 잠금은 응답 도착이 아니라 목록·커서·로딩 상태의 화면 반영 뒤에 푼다. 첫 페이지 교체 이전의 응답은 버리고 로딩을 함께 정리하며, 페이지 경계에서 겹친 게시물 ID는 다시 추가하지 않는다. 미디어 수화는 같은 요청 세대의 URL 필드만 병합한다 — 게시물 행 전체를 덮으면 늦은 응답이 최신 내용까지 되돌린다.
- 댓글·반응 뮤테이션은 route를 재검증하지 않는다. 재검증하면 펼쳐 둔 답글 묶음과 위로 불러온 이전 페이지가 통째로 초기화된다. RPC가 돌려주는 정본 행을 병합한다(`hooks/use-post-comments.ts`).
- 반응은 누르는 즉시 로컬 계산으로 앞서 나가고 정본으로 덮는다. **상위 반응은 로컬에서 계산하지 마라** — 내 반응 하나로는 남들의 순위를 알 수 없다. `applyReactionLocally()`가 내 반응과 총계만 건드리는 이유다.
- 댓글 수와 게시물 반응은 `postId`별 TanStack Query engagement overlay를 카드·행·상세가 함께 구독한다. 생성·삭제 RPC가 돌려주는 `post_comment_count`는 절대값으로 그대로 얹고, 반응은 총계·내 반응만 먼저 계산한 뒤 서버 정본으로 덮는다. route 재검증이나 목록 원본·미디어 수화본 patch로 맞추지 마라 — 펼쳐 둔 답글 묶음과 이전 페이지를 유지하면서 늦은 수화본도 최신 표시를 되돌리지 못하게 한다. overlay를 먼저 비우는 것은 화면 전체를 다시 읽는 당겨서 새로고침뿐이다 — 피드 새 세션을 여는 그룹 가입이나 글 저장은 비우지 마라(`docs/DATA_CACHE_POLICY.md`).
- 피드 상세의 `useFetcher` 데이터는 닫아도 남는다. 같은 게시물을 다시 열 때는 명시적으로 다시 읽어라 — "이미 이 글의 데이터가 있다"로 판단하면 방금 쓴 댓글이 빠진 예전 응답이 뜬다.

## `#업`

- 유효 `#업` 사건의 원인 댓글은 피드 순위와 쿨다운의 감사 기준이다. 작성자와 운영진 모두 수정·삭제할 수 없으며, 댓글 읽기 RPC의 `is_effective_feed_bump`만 화면에서 파란색 표시와 메뉴 숨김을 결정한다. 본문·depth·신원을 클라이언트가 다시 해석하지 마라.

## 그 밖에

- 댓글 본문은 평문이다. 게시물의 Markdown 파이프라인(`model/markdown.ts`)을 타지 않는다.
- 게시물 Markdown을 읽는 곳은 정화(`model/markdown.ts`), 읽기 화면(`PostMarkdown`), 편집기 셋이고 remark 플러그인이 같아야 한다. 앞의 둘은 `postMarkdownPlugins`를 함께 쓰지만 Milkdown은 `$remark`로 따로 단다. 특히 CJK 강조 플러그인을 한 곳에서만 빼면 그곳만 `**끝.**다음`을 글자로 읽는다. 편집기는 Milkdown이 덮어쓴 `text`·`strong`·`emphasis` 직렬화 처리기도 걷어 낸다 — 남겨 두면 문단 머리 `- `가 escape되지 않아 정화가 목록으로 읽고 `-`를 지운다.
- 줄바꿈 하나를 문단으로 가르는 `toMilkdownMarkdown()`은 편집기에 넣을 때만 쓴다. 이 변환을 공용 `toPostEditorMarkdown()`에 옮기지 마라 — `sanitizePostMarkdown()`과 `toPostRenderMarkdown()`이 같은 함수를 써서 정화 결과와 읽기 화면까지 함께 바뀐다.
- `model/reactions.ts`의 `REACTION_TYPES` 순서를 `public.post_reaction` enum과 맞춰 두어라. 서버가 같은 수의 상위 반응을 enum 순서로 가르므로, 어긋나면 화면과 서버의 "많이 쓰인 순"이 달라진다.
- 반응 그래픽은 `public/twemoji/15.1.0/<codepoint>.svg`에 담아 둔 Twemoji다. 서비스 워커가 `public/`을 프리캐시하므로 오프라인에서도 보인다. 실행 시점에 CDN에서 받지 마라.
- `media_kind`가 있는 첨부의 `signedUrl`은 MP4다. `<img>`에 넣지 마라. 격자는 `MotionTile`, 뷰어는 `motion`을 쓰고, 표지처럼 이미지가 필요한 자리는 `attachmentMotionKind`로 걸러라. 어기면 조용히 빈 칸만 남는다.
