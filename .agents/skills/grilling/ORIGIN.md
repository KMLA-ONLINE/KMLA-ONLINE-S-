---
source: https://github.com/mattpocock/skills
source_path: skills/productivity/grilling
revision: 49dd158d1076134a641b33efb035946536778336
imported_at: "2026-10-14"
---

# 출처

Matt Pocock의 `grilling` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`에 원본 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다.

개인 전역 설치본을 복사하거나 업데이트한 것이 아니라 위 커밋의 원본을 새로 가져왔습니다. 이 리비전과 날짜는 개인 전역 설치본의 과거 출처를 의미하지 않습니다.

## Rewrite 목적

설계 트리의 frontier를 라운드별로 질문하는 흐름을 유지하면서 sub-agent 사용 여부와 관계없이 OpenCode와 Claude Code에서 사실 조사를 수행할 수 있게 합니다. 다른 프로젝트 스킬의 필수 의존성으로 함께 설치합니다.

## 주요 변경 사항

- 사실 조사는 exploration sub-agent가 사용 가능하고 허용되면 위임하고, 그렇지 않으면 동일한 brief로 직접 수행하도록 했습니다. 사용자에게 조사 가능한 사실을 묻지 않는 원칙은 유지했습니다.
- 설계 트리·frontier·라운드별 질문 형식·추천 답변·"yes"의 추천 수락 의미·최종 합의 후 행동이라는 원칙은 그대로 유지했습니다.
- OpenCode와 Claude Code용 실행 자료가 아닌 Codex 표시 메타데이터 `agents/openai.yaml`은 기존 파생본 관례대로 포함하지 않았습니다. 저장소 Prettier 서식을 적용하며 새 도구·패키지 의존성이나 자동 upstream 동기화는 추가하지 않았습니다.
