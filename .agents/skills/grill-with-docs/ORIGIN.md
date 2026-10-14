---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/grill-with-docs
revision: 49dd158d1076134a641b33efb035946536778336
imported_at: "2026-10-14"
---

# 출처

Matt Pocock의 `grill-with-docs` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`에 원본 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다.

## Rewrite 목적

`grilling`과 `domain-modeling`을 함께 사용하는 간결한 조합을 유지하면서 프로젝트의 기존 문서 위치와 편집 권한을 명시합니다.

## 주요 변경 사항

- 특정 Skill 도구 대신 현재 에이전트의 skill 로딩 방식으로 두 스킬을 불러오도록 했습니다. 두 의존 스킬은 프로젝트에 함께 설치합니다.
- 루트 용어집 생성 대신 기존 `docs/functional-spec/glossary.md`를 사용하고 `docs/README.md`의 문서 책임을 따릅니다. 설명도 자동 ADR 생성이 아니라 중요한 설계 결정 기록으로 조정했습니다.
- 프로젝트 문서의 즉시 수정은 허용 모드와 승인 범위에 한정합니다. Plan 모드에서는 변경안을 대화로 정리하고, 기존 설계를 우선하며 별도 ADR은 기준을 충족할 때만 제안합니다.
- 수동 호출을 위한 `disable-model-invocation`은 유지했습니다. OpenCode와 Claude Code용 실행 자료가 아닌 Codex 표시 메타데이터 `agents/openai.yaml`은 기존 파생본 관례대로 포함하지 않았습니다. 새 도구·패키지 의존성이나 자동 upstream 동기화는 추가하지 않았습니다.
