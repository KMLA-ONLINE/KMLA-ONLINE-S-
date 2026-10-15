---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/domain-modeling
revision: 49dd158d1076134a641b33efb035946536778336
imported_at: "2026-10-14"
---

# 출처

Matt Pocock의 `domain-modeling` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`, `DECISION-RECORDS.md`(원본 `ADR-FORMAT.md`), `GLOSSARY-FORMAT.md`에 원본 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다.

## Rewrite 목적

용어 충돌 지적·구체적 시나리오·코드 대조·합의 기록이라는 원칙을 유지하면서 기존 기능 명세와 용어집의 형식 및 문서 책임을 존중합니다.

## 주요 변경 사항

- 일반적인 루트·다중 컨텍스트 용어집 생성 규칙을 프로젝트의 `docs/functional-spec/glossary.md` 사용 규칙으로 대체했습니다. 설명의 trigger도 실제 용어집과 설계 결정에 맞췄습니다.
- 기존 표·명세 참조·코드/스키마 대응 열을 보존합니다. 원본의 구현 정보 전면 금지는 기존 대응 정보의 보존과 새 요구·설계 결정의 정본 분리로 조정했습니다.
- `SKILL.md`의 일반 파일 배치 예제는 ADR 디렉터리를 포함해 제거했습니다. `GLOSSARY-FORMAT.md`의 원본 정의·다중 컨텍스트 예제는 유지하되 다른 저장소의 예제로 명시했습니다. 프로젝트용 표 형식이 우선하며 새 루트 용어집이나 컨텍스트 용어집을 만들지 않습니다.
- 명세 인덱스·Agent Map·문서 안내와 관련 feature 지침에서 탐색을 시작합니다. 기존 명세·기술 설계·feature 불변식의 소유자를 우선합니다.
- 프로젝트는 ADR을 두지 않으므로 `ADR-FORMAT.md`를 `DECISION-RECORDS.md`로 바꿨습니다. 기록 여부의 세 가지 기준과 예시는 유지하고, 결정 이유를 코드 주석·feature `AGENTS.md`·기술 설계·명세 중 범위에 맞는 곳에 적도록 했습니다.
- 즉시 기록은 쓰기가 허용되는 모드와 승인 범위에 한정합니다. Plan 모드에서는 변경안을 대화로 정리합니다. 제품 동작 변경에는 사용자 결정 및 명세·설계 동시 갱신과 안정적인 절 번호 보존이 필요합니다.
- OpenCode와 Claude Code용 실행 자료가 아닌 Codex 표시 메타데이터 `agents/openai.yaml`은 기존 파생본 관례대로 포함하지 않았습니다. 저장소 Prettier 서식을 적용하며 새 도구·패키지 의존성이나 자동 upstream 동기화는 추가하지 않았습니다.
