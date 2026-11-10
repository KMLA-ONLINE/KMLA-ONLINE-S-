---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/domain-modeling
revision: 49dd158d1076134a641b33efb035946536778336
imported_at: "2026-10-14"
---

# 출처

Matt Pocock의 `domain-modeling` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`, `ADR-FORMAT.md`, `GLOSSARY-FORMAT.md`에 원본 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다.

## Rewrite 목적

용어 충돌 지적·구체적 시나리오·코드 대조·합의 기록이라는 원칙을 유지하면서 기존 기능 명세와 용어집의 형식 및 문서 책임을 존중합니다.

## 주요 변경 사항

- 일반적인 루트·다중 컨텍스트 용어집 생성 규칙을 프로젝트의 `docs/functional-spec/glossary.md` 사용 규칙으로 대체했습니다. 설명의 trigger도 실제 용어집과 설계 결정에 맞췄습니다.
- 기존 표·명세 참조·코드/스키마 대응 열을 보존합니다. 원본의 구현 정보 전면 금지는 기존 대응 정보의 보존과 새 요구·설계 결정의 정본 분리로 조정했습니다.
- `SKILL.md`의 일반 파일 배치 예제와 `GLOSSARY-FORMAT.md`의 원본 정의·다중 컨텍스트 예제는 유지하되 다른 저장소의 예제로 명시했습니다. 프로젝트용 표 형식이 우선하며 새 루트 용어집이나 컨텍스트 용어집을 만들지 않습니다.
- 명세 인덱스·Agent Map·문서 안내와 관련 feature 지침에서 탐색을 시작합니다. 기존 명세·기술 설계·feature 불변식의 소유자를 우선하고, 결정 이유의 기록 위치는 `docs/adr/README.md`의 구분(코드 주석·feature `AGENTS.md`·소유 문서·ADR)을 따릅니다. ADR은 여러 곳에 걸친 결정이 원본의 세 기준을 충족할 때만 제안합니다.
- `ADR-FORMAT.md`의 기록 기준과 예제는 유지했습니다. 배치·파일명·번호·상태 규칙은 정본인 `docs/adr/README.md`를 가리키도록 바꿨고, 템플릿과 상태 값은 프로젝트 문서 언어에 맞춰 한국어로 바꿨습니다. 채택한 ADR은 고치지 않고 새 ADR로 대체합니다.
- #247에서 `ADR-FORMAT.md`를 `DECISION-RECORDS.md`로 바꿨던 변경은 [ADR-0001](../../../docs/adr/0001-reintroduce-adrs.md)에 따라 되돌렸습니다. #247에서 더한 코드 주석 기록 위치는 유지했습니다.
- 즉시 기록은 쓰기가 허용되는 모드와 승인 범위에 한정합니다. Plan 모드에서는 변경안을 대화로 정리합니다. 제품 동작 변경에는 사용자 결정 및 명세·설계 동시 갱신과 안정적인 절 번호 보존이 필요합니다.
- OpenCode와 Claude Code용 실행 자료가 아닌 Codex 표시 메타데이터 `agents/openai.yaml`은 기존 파생본 관례대로 포함하지 않았습니다. 저장소 Prettier 서식을 적용하며 새 도구·패키지 의존성이나 자동 upstream 동기화는 추가하지 않았습니다.
