<!--
제목: 영어, 명령형 (예: "Show private groups in global search"). 본문: 한국어.
- 해당 없는 절은 지운다. diff로 보이는 내용(파일 목록, 코드 요약)은 반복하지 않는다.
- bullet 하나는 한 줄. 이유가 길면 리뷰 포인트로 옮긴다.
- 전후 비교나 항목이 3개 이상 나란하면 표로 쓴다.
-->

## 왜

<!-- 해결하는 문제나 요청 1~3줄. 관련 이슈·PR 링크. -->

## 바뀌는 동작

<!-- 사용자·개발자가 겪는 변화. 전후 비교는 | 전 | 후 | 표로. -->

## 리뷰 포인트

<!-- 리뷰어가 꼭 봐야 할 곳만. `path:line` — 판단한 이유, 사용자 확인 없이 둔 가정, 깨질 수 있는 동작. -->

## 명세·문서

<!-- 갱신한 명세 §, feature AGENTS.md, Agent Map, 용어집. -->

## DB·배포

<!-- migration과 grant·RLS·파괴적 구문 여부. dev에 merge한 뒤 할 일. dev DB·Edge Function은 merge 후 자동 배포된다. -->

## 릴리즈

<!--
prod에서 직접 할 일만 `-` 목록으로 한 줄씩 (Vault·Function 시크릿, Vercel 변수, Dashboard 설정, 데이터 확인).
없으면 절을 지운다. 릴리즈 대기 목록 이슈와 릴리즈 PR에 모이고, 릴리즈가 끝나면 체크리스트 이슈가 된다
(docs/DOCKER.md §5.5). `.env.example`, `supabase/.env.example`, `supabase/config.toml` 변경은 자동으로
할 일에 들어가므로 따로 적지 않아도 된다.
-->

## 검증

<!-- 실행한 명령과 결과. 확인하지 못한 것은 "미확인:"으로 시작해 따로 적는다. -->
