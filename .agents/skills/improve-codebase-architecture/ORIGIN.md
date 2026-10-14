---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/improve-codebase-architecture
revision: 49dd158d1076134a641b33efb035946536778336
imported_at: "2026-10-14"
---

# 출처

Matt Pocock의 `improve-codebase-architecture` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`와 `HTML-REPORT.md`에 원본 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다.

## Rewrite 목적

deepening 후보 탐색, 시각 보고서, 선택한 후보의 인터뷰라는 흐름을 보존하면서 KMLA Online의 기존 용어집·문서 책임·코드 경계와 OpenCode 및 Claude Code의 실행 제약에 맞춥니다.

## 주요 변경 사항

- 루트 `GLOSSARY.md` 대신 `docs/functional-spec/glossary.md`를 사용하며 새 용어집을 만들지 않습니다. 기존 기술 설계와 feature `AGENTS.md`의 결정도 검토하고 충돌 근거를 표시합니다.
- 코드 탐색은 Agent Map과 해당 feature 지침에서, 제품 동작 확인은 명세 인덱스에서 시작합니다. deepening 제안이 기존 레이어·I/O 규칙을 우회하지 않도록 합니다.
- 특정 Skill 도구 호출 대신 현재 에이전트의 skill 로딩 방식을 사용합니다. 탐색 sub-agent가 사용 가능하고 허용되면 원본 방식을 유지하고, 아니면 동일한 brief로 직접 탐색합니다. 대안 인터페이스 비교는 기존 `codebase-design`의 순차 fallback도 사용합니다.
- 환경이 지정한 승인된 임시 작업 공간을 보고서 위치로 우선합니다. 파일 쓰기가 금지된 모드에서는 후보를 대화로 제시하고 HTML 생성을 미룹니다.
- 프로젝트 문서의 즉시 수정은 쓰기가 허용되는 모드와 승인 범위에 한정합니다. 제품 동작 변경은 사용자 결정과 해당 명세·설계 갱신을 필요로 합니다. 프로젝트는 ADR을 두지 않으므로, 거절된 후보의 이유는 코드 주석이나 소유 설계·feature `AGENTS.md`에 기록하도록 제안하고 보고서의 ADR callout은 결정 callout으로 바꿨습니다.
- HTML 보고서의 예제·시각 구성·Tailwind 및 Mermaid CDN은 유지했습니다. 저장소 Prettier에 따른 Markdown과 예제 코드 서식 차이는 허용하되 기능은 변경하지 않았습니다.
- `codebase-design`, `grilling`, `domain-modeling`에 의존합니다. 모두 프로젝트에 설치되어 있으며 별도 npm 패키지는 추가하지 않습니다. 보고서 렌더링에는 CDN 네트워크 접근이 필요합니다.
- OpenCode와 Claude Code용 실행 자료가 아닌 Codex 표시 메타데이터 `agents/openai.yaml`은 기존 파생본 관례대로 포함하지 않았습니다. 자동 upstream 동기화는 추가하지 않았습니다.
