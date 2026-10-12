---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/tdd
revision: 6fd947921b935b7e1e69293a200400f0fdd5c15f
imported_at: "2026-10-07"
---

# 출처

Matt Pocock의 `tdd` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`, `tests.md`, `mocking.md`에 원본의 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다.

기존에 설치되어 있던 로컬 `tdd`를 가져온 것이 아니라, 위 커밋의 원본을 새로 확인해 도입했습니다. 해당 커밋은 기존 설치본의 과거 리비전을 의미하지 않습니다.

## Rewrite 목적

행동 중심 테스트, 합의된 테스트 경계, 한 번에 하나의 red → green 슬라이스라는 원칙을 유지하면서 OpenCode와 Claude Code에서 공통으로 사용하고, 요청하지 않은 리뷰 스킬에 의존하지 않도록 합니다.

## 주요 변경 사항

- 특정 `Skill` 도구 호출과 저장소 구조를 가정하는 상대 링크 대신, `codebase-design`을 사용 가능할 때 참고하도록 했습니다. 설치되어 있지 않으면 프로젝트 관례에서 public interface와 테스트 경계를 도출한 뒤 사용자와 확인하도록 하여, 필수 의존성을 선택적 참고로 변경했습니다. 실행 지침에서 저장소 관리에 관한 설명은 제거했습니다.
- `code-review` 스킬 의존성을 제거하고 별도 리뷰 단계에서 리팩터링한 뒤 테스트를 재실행하도록 했습니다. 리팩터링을 red → green 루프 밖에 두는 원칙은 유지했습니다.
- `tests.md`와 `mocking.md`의 예제와 원칙은 원본 그대로 보존했습니다.
- OpenCode와 Claude Code에서 필요한 용도가 확인되지 않은 `agents/openai.yaml`은 포함하지 않았습니다.
- 새 외부 패키지·도구 의존성이나 자동 upstream 동기화는 추가하지 않았습니다. 기존 설치본과 설치 링크는 변경하지 않았습니다.
