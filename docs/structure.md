```
app/
  root.tsx
  routes.ts              ← 유지. 전체 URL 지도 = 에이전트의 진입 인덱스
  shared/
    ui/                  ← shadcn 원자 (import 174회, 확실한 공유물)
    lib/                 ← utils, time, reactions, image, rich-text, crypto
    hooks/
    supabase/            ← client.ts, database.types.ts, storage.ts
    components/          ← relative-time, file-drop-overlay 등 도메인 없는 것
  domains/
    <domain>/
      AGENTS.md          ← 이 도메인의 규칙/불변조건 (선택, 아래 설명)
      routes/            ← clientLoader/clientAction = 백엔드 seam
      components/
      data/              ← queries.ts, mutations.ts. Supabase 호출은 여기서만
      model/             ← types.ts(database.types.ts 파생), format.ts, constants.ts
      mock.ts            ← 나중에 통째로 지울 파일 하나
      index.ts           ← public API. 외부 도메인은 여기로만 import
```
