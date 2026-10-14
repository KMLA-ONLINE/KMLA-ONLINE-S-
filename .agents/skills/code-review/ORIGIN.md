---
source: https://github.com/mattpocock/skills
source_path: skills/engineering/code-review
revision: 49dd158d1076134a641b33efb035946536778336
imported_at: "2026-10-14"
---

# 출처

Matt Pocock의 `code-review` 스킬을 위 커밋에서 가져와 독립적으로 유지하는 파생본입니다. `SKILL.md`에 원본 내용이 포함됩니다. 저장소 루트의 MIT 라이선스와 저작권 표시는 동봉한 [LICENSE](LICENSE)에 보존했습니다. Fowler의 코드 냄새에 대한 원본 출처 표시도 유지했습니다.

## Rewrite 목적

독립적인 Standards·Spec 평가와 프로젝트 정본 탐색을 유지하면서 OpenCode의 버그 중심 검증·대상 선택을 결합합니다. Correctness를 별도 축으로 두고 수동 리뷰와 이번 요청의 자동 완료 리뷰를 구분합니다.

## 최초 도입 이력 — 2026-10-14

- 존재하지 않는 `/setup-matt-pocock-skills` 및 tracker 문서 의존을 제거했습니다. 사용자 제공 자료·커밋의 이슈 참조·프로젝트 명세를 사용하고 외부 조회 도구나 권한이 없으면 그 한계를 알립니다.
- 명세 인덱스·Agent Map·관련 기술 설계와 root/feature `AGENTS.md` 등 실제 정본을 검토 출발점으로 사용합니다. 미구현 명세를 현재 동작이나 요청된 범위로 간주하지 않습니다.
- 브랜치 리뷰의 merge-base diff는 유지합니다. WIP에서는 merge-base와 작업 트리를 비교하여 staged·unstaged 변경을 포함하고, diff에 나오지 않는 관련 untracked 파일은 따로 읽습니다. 양 축에 동일한 범위를 전달하며 모호하면 먼저 확인합니다.
- ref 검증을 commit 기준으로 명시하고 shell 인자로 안전하게 처리하도록 했습니다. 리뷰는 읽기 전용이며 별도 수정 요청과 허용 모드 없이 파일을 변경하지 않습니다.
- sub-agent 사용이 가능하고 허용되면 독립 병렬 리뷰를 유지하고, 아니면 같은 brief로 독립적인 순차 리뷰를 수행합니다. 400단어 제한·두 보고서·축별 요약·교차 재순위 금지는 유지했습니다.
- smell baseline 전체와 저장소 규칙 우선·휴리스틱 구분·도구가 강제하는 항목 제외라는 원칙은 유지했습니다.
- OpenCode와 Claude Code용 실행 자료가 아닌 Codex 표시 메타데이터 `agents/openai.yaml`은 기존 파생본 관례대로 포함하지 않았습니다. 저장소 Prettier 서식을 적용하며 새 설정 스킬·패키지 의존성이나 자동 upstream 동기화는 추가하지 않았습니다.

## 추가 출처 — OpenCode 리뷰 템플릿

- 출처: https://github.com/anomalyco/opencode
- 원본 경로: `packages/opencode/src/command/template/review.txt`
- 리비전: `fc7e4cf93e660ad5ddabb0c48ecc99e934ebfe95`
- 반영 날짜: 2026-10-14
- 원본: [고정 리비전의 review.txt](https://github.com/anomalyco/opencode/blob/fc7e4cf93e660ad5ddabb0c48ecc99e934ebfe95/packages/opencode/src/command/template/review.txt)
- 라이선스: 원본 저장소 루트의 MIT 라이선스와 `Copyright (c) 2025 opencode`를 [LICENSE.opencode](LICENSE.opencode)에 보존했습니다. 기존 Matt Pocock [LICENSE](LICENSE)는 유지합니다.

제공된 `dev` 경로는 확인 당시 404였으며, 경로 삭제 직전 커밋의 자료를 가져왔습니다. 이 템플릿을 현재 OpenCode V2 기본 명령의 동작으로 주장하지 않습니다. 위 frontmatter는 최초 Matt Pocock 자료의 출처이며, 이 추가 출처의 리비전이나 기존 개인 설치본의 과거 리비전을 대신하지 않습니다.

## 결합 변경 사항 — 2026-10-14

- 무인자 수동 리뷰는 미커밋 변경을 대상으로 합니다. SHA는 단일 커밋, 브랜치는 merge-base 비교, PR은 해당 PR diff로 분기합니다. 기존 SHA 기준 범위 리뷰는 `since X`처럼 범위를 명시할 때 사용합니다. WIP를 포함한 기준점 이후 비교는 유지합니다.
- Correctness를 추가하여 버그·보안·명백한 성능 문제·의도하지 않은 동작 변경을 확인합니다. Standards와 Spec의 책임, smell baseline 전체, 독립 리뷰, 축별 400단어 제한, 교차 재순위 금지는 유지합니다. 명세가 없어도 Correctness와 Standards는 실행하며 현재 승인된 요청 자체도 명세 근거가 될 수 있습니다.
- diff만 보지 않고 해당 버전의 전체 파일과 필요한 호출 맥락을 확인합니다. 현실적인 발생 조건·근거·심각도를 제시하며 검증하지 못한 우려는 확정 지적과 구분합니다. 관련 없는 기존 결함과 스타일 취향을 리뷰 범위에 넣지 않습니다.
- 자동 완료 리뷰는 작업 시작의 HEAD·기존 diff·관련 파일 내용과 작업 완료 상태를 비교합니다. 기존 사용자 변경과 같은 파일에 있는 이번 작업 변경도 구분합니다. 기록 부재·동시 변경으로 범위가 불명확하면 확인 요청하며 전체 미커밋 리뷰로 몰래 대체하지 않습니다.
- 축별로 다른 상태를 읽지 않도록 공통 리뷰 범위·버전·patch·제외 근거를 고정해 전달합니다. staged/index와 작업 트리, PR과 로컬 checkout의 버전을 혼동하지 않습니다.
- OpenCode 원본의 Explore·Exa·웹 검색은 사용 가능한 인가된 탐색·문서 도구로 일반화했습니다. `gh` 같은 PR 도구는 사용 가능할 때만 쓰며 없으면 자료 제공을 요청합니다. 특정 서비스·패키지를 새 필수 의존성으로 설치하지 않습니다.
- 리뷰 준비를 이유로 commit·stash·reset·branch 전환·도구 설치를 하지 않습니다. Plan 모드의 파일 쓰기 제한과 기존 읽기 전용·승인 범위 규칙을 유지합니다. README 설명이나 자동 upstream 동기화는 추가하지 않았습니다.
