# KMLA Online 기능 명세서

이 문서는 KMLA Online 기능 명세의 대표 진입점이며, 상세 내용은 도메인별 문서로 분리되어 있다.

- [1-5. 서비스 개요, 사용자 및 권한 체계, 공통 화면 및 내비게이션, 인증 및 계정, 학교 프로필 설정 및 가입 승인](functional-spec/01-accounts-and-onboarding.md)
- [6-7. 홈 통합 피드, 그룹](functional-spec/02-feed-and-groups.md)
- [8-11. 게시물, 댓글 및 답글, 반응, 익명 활동 관리](functional-spec/03-posts-and-interactions.md)
- [12. 프로필](functional-spec/04-profiles.md)
- [13. 메시지](functional-spec/05-messaging.md)
- [14-16. 알림, 메뉴 및 개인 설정, 앱 관리자](functional-spec/06-notifications-and-admin.md)
- [17-19. 권한 기반 학교 부가 기능, 동아리 및 지원, 콘텐츠 및 미디어 공통 규칙](functional-spec/07-school-features-and-media.md)

## 관련 기술 설계

- [홈 통합 피드 알고리즘](FEED_ALGORITHM.md): 피드 후보, 6시간 랭킹, `#업`, 출처 제한, 피드 세션 및 안정적인 페이지네이션을 정의한다.
- [Supabase Storage 버킷 설계](STORAGE_BUCKETS.md): 기능 요구사항을 중복하지 않고 구현 및 Storage 세부 사항을 정의한다.
- [콘텐츠 서식 및 이모지 설계](CONTENT_FORMATTING.md): 게시물 Markdown, 메시지 평문 입력기, 안전한 렌더링 및 Unicode 이모지 처리 방식을 정의한다.
- [알림 수동 인수 테스트](NOTIFICATION_MANUAL_TESTING.md): 실제 브라우저, 운영체제, 설치형 PWA, Push Service 및 이메일 제공자를 거쳐 확인할 수동 테스트를 정의한다.
- [알림 및 Web Push 기술 설계](NOTIFICATION_TECHNICAL_DESIGN.md): 알림 데이터, 구독, outbox, 전달 worker, 서비스 워커 및 보안 경계를 정의한다.
- [클라이언트 데이터 캐시 정책](DATA_CACHE_POLICY.md): 쿼리 키, 신선도, 보관 범위 및 mutation 무효화 규칙을 정의한다.
