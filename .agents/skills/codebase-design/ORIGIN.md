---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/codebase-design
revision: 6fd947921b935b7e1e69293a200400f0fdd5c15f
imported_at: "2026-10-07"
---

# 출처

Matt Pocock의 `codebase-design` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`, `DEEPENING.md`, `DESIGN-IT-TWICE.md`에 원본의 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다.

원본의 seam 개념은 Michael Feathers, Design It Twice 접근은 Ousterhout에 대한 출처 표시를 그대로 유지했습니다.

## Rewrite 목적

deep module의 공통 용어와 설계 원칙을 유지하면서 기존 테스트의 회귀 검증을 안전하게 대체하고, OpenCode와 Claude Code에서 병렬 에이전트 사용 가능 여부와 관계없이 대안 인터페이스를 비교할 수 있게 합니다.

## 주요 변경 사항

- 기존 shallow module 테스트의 일괄 삭제 지침을 변경했습니다. 중요한 행동·회귀 사례가 새 인터페이스 테스트로 대체되었는지 확인하고 실행한 뒤, 대체된 중복·구현 결합 테스트만 제거합니다. 대체되지 않은 행동 검증은 유지하거나 옮깁니다.
- 병렬 에이전트가 사용 가능하고 허용되면 원본 방식을 유지하고, 그렇지 않으면 동일한 제약을 사용한 세 가지 이상의 대안을 순차 작성하도록 했습니다. 대안별 출력, 비교 기준, 최종 추천은 유지했습니다.
- 대안 설계에서는 컨텍스트에 이미 로드된 프로젝트 지침이 지정한 용어집을 파일명·위치와 관계없이 읽도록 했습니다. 경로 확인만을 위해 `AGENTS.md`, `CLAUDE.md` 등을 다시 읽도록 요구하지 않으며, 지정이 없을 때만 프로젝트 루트의 `GLOSSARY.md`를 확인합니다. 지정 경로가 모호하거나 파일이 없으면 임의로 대체하지 않고 알리도록 했습니다.
- 용어 정의, deep module 설계 철학, 의존성 분류와 예제는 유지했습니다.
- OpenCode와 Claude Code에서 필요한 용도가 확인되지 않은 `agents/openai.yaml`은 포함하지 않았습니다.
- 새 외부 패키지·도구·스킬 의존성이나 자동 upstream 동기화는 추가하지 않았습니다.
