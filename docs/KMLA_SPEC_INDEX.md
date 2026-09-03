# KMLA Online 기능 명세서

이 문서는 KMLA Online 기능 명세의 대표 진입점이며, 상세 내용은 도메인별 문서로 분리되어 있다.

## 장 번호 규칙

장·절 번호(`§8.4` 형태)는 코드 주석이 참조하는 안정적인 식별자다. 파일 이름은 도메인을 따르고 번호는 문서 안에만 있으므로, 문서를 옮기거나 나눠도 번호는 바뀌지 않는다.

- 절을 추가할 때는 해당 장의 마지막 번호 뒤에 붙인다.
- 번호를 당기거나 다른 뜻으로 재사용하려면 먼저 그 번호를 가리키는 참조를 전부 찾고(`grep -rn "§17" docs/ app/`) 같은 커밋에서 함께 고친다. 확인 없이 바꾸면 참조가 조용히 다른 곳을 가리키게 된다.
- 참조를 옮길 수 없으면 번호를 비워 두고 새 번호를 쓴다.

## 도메인별 명세

| 장    | 문서                                                               | 내용                                                        |
| ----- | ------------------------------------------------------------------ | ----------------------------------------------------------- |
| §1–5  | [계정 및 온보딩](functional-spec/accounts.md)                      | 서비스 개요, 권한 체계, 내비게이션, 인증, 가입 승인         |
| §6    | [홈 통합 피드](functional-spec/feed.md)                            | 피드 구성과 정렬,`#업`, 보기 방식, 홈 위젯                  |
| §7    | [그룹](functional-spec/groups.md)                                  | 그룹 종류, 가입 정책, 초대, 멤버와 역할, 그룹 설정          |
| §8–11 | [게시물 및 상호작용](functional-spec/posts.md)                     | 게시물, 댓글과 답글, 반응, 익명 활동 관리                   |
| §12   | [프로필](functional-spec/profiles.md)                              | 프로필 열람과 편집, 프로필 타임라인                         |
| §13   | [메시지](functional-spec/messaging.md)                             | 1:1 및 그룹 메시지 ·**미구현**, 화면 골격만 있음            |
| §14   | [알림](functional-spec/notifications.md)                           | 알림함, 중요도와 전달 채널, 알림 종류별 정책                |
| §15   | [메뉴 및 개인 설정](functional-spec/settings.md)                   | 메뉴 홈, 알림 설정, 실험실, 라이선스, 도움말, 업데이트 기록 |
| §16   | [앱 관리자](functional-spec/admin.md)                              | 가입 심사, 앱 관리자 임명, 권한 기반 기능 관리자            |
| §17   | [학교 부가 기능](functional-spec/school-features.md)               | 공강·노래방 예약, 급식, 생일, 공결·병결, 시간표             |
| §18   | [콘텐츠 및 미디어 공통 규칙](functional-spec/content-and-media.md) | 이미지 처리, 파일 접근, 콘텐츠 보존, 이미지 뷰어            |
| —     | [용어집](functional-spec/glossary.md)                              | 명세와 코드에서 쓰는 도메인 용어                            |

## 관련 기술 설계

- [홈 통합 피드 알고리즘](FEED_ALGORITHM.md): 피드 후보, 6시간 랭킹, `#업`, 출처 제한, 피드 세션 및 안정적인 페이지네이션을 정의한다.
- [Supabase Storage 버킷 설계](STORAGE_BUCKETS.md): 기능 요구사항을 중복하지 않고 구현 및 Storage 세부 사항을 정의한다.
- [콘텐츠 서식 및 이모지 설계](CONTENT_FORMATTING.md): 게시물 Markdown, 메시지 평문 입력기, 안전한 렌더링 및 Unicode 이모지 처리 방식을 정의한다.
- [알림 수동 인수 테스트](NOTIFICATION_MANUAL_TESTING.md): 실제 브라우저, 운영체제, 설치형 PWA, Push Service 및 이메일 제공자를 거쳐 확인할 수동 테스트를 정의한다.
- [알림 전달 파이프라인 점검](NOTIFICATION_DISPATCH_RUNBOOK.md): 알림이 오지 않을 때 cron, pg_net, outbox, 발송 결과를 단계별로 좁히는 진단 절차와 함정을 정의한다.
- [알림 및 Web Push 기술 설계](NOTIFICATION_TECHNICAL_DESIGN.md): 알림 데이터, 구독, outbox, 전달 worker, 서비스 워커 및 보안 경계를 정의한다.
- [클라이언트 데이터 캐시 정책](DATA_CACHE_POLICY.md): 쿼리 키, 신선도, 보관 범위 및 mutation 무효화 규칙을 정의한다.
