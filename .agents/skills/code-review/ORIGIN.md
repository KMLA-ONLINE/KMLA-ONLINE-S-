---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/code-review
revision: 49dd158d1076134a641b33efb035946536778336
imported_at: "2026-10-14"
---

# 출처

Matt Pocock의 `code-review` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`에 원본 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다. Fowler의 코드 냄새에 대한 원본 출처 표시도 유지했습니다.

## Rewrite 목적

Standards와 Spec을 독립적으로 평가하는 원칙을 유지하면서 실제 프로젝트 명세·작업 규칙을 근거로 삼고 미커밋 변경도 누락 없이 검토합니다.

## 주요 변경 사항

- 존재하지 않는 `/setup-matt-pocock-skills` 및 tracker 문서 의존을 제거했습니다. 사용자 제공 자료·커밋의 이슈 참조·프로젝트 명세를 사용하고 외부 조회 도구나 권한이 없으면 그 한계를 알립니다.
- 명세 인덱스·Agent Map·관련 기술 설계와 root/feature `AGENTS.md` 등 실제 정본을 검토 출발점으로 사용합니다. 미구현 명세를 현재 동작이나 요청된 범위로 간주하지 않습니다.
- 브랜치 리뷰의 merge-base diff는 유지합니다. WIP에서는 merge-base와 작업 트리를 비교하여 staged·unstaged 변경을 포함하고, diff에 나오지 않는 관련 untracked 파일은 따로 읽습니다. 양 축에 동일한 범위를 전달하며 모호하면 먼저 확인합니다.
- ref 검증을 commit 기준으로 명시하고 shell 인자로 안전하게 처리하도록 했습니다. 리뷰는 읽기 전용이며 별도 수정 요청과 허용 모드 없이 파일을 변경하지 않습니다.
- sub-agent 사용이 가능하고 허용되면 독립 병렬 리뷰를 유지하고, 아니면 같은 brief로 독립적인 순차 리뷰를 수행합니다. 400단어 제한·두 보고서·축별 요약·교차 재순위 금지는 유지했습니다.
- smell baseline 전체와 저장소 규칙 우선·휴리스틱 구분·도구가 강제하는 항목 제외라는 원칙은 유지했습니다.
- OpenCode와 Claude Code용 실행 자료가 아닌 Codex 표시 메타데이터 `agents/openai.yaml`은 기존 파생본 관례대로 포함하지 않았습니다. 저장소 Prettier 서식을 적용하며 새 설정 스킬·패키지 의존성이나 자동 upstream 동기화는 추가하지 않았습니다.
