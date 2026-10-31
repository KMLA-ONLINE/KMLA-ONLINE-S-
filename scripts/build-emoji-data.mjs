// `app/shared/lib/emoji/emoji-data.json`을 emojibase에서 다시 만든다. 메시지 반응 선택창이 쓴다.
//
// 실행 시점에 전체 데이터를 들고 다니지 않도록, 화면이 쓰는 필드만 남기고 피부색 변형은 뺀다.
// 기기가 아직 못 그리는 새 이모지는 빈 네모로 보이므로 Unicode 15.1까지만 담는다 — iOS 17.4와
// Android 14가 그리는 마지막 판이다. 올릴 때는 아래 상한과 같이 올린다.
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const data = require("emojibase-data/ko/data.json");
const messages = require("emojibase-data/ko/messages.json");

const MAX_VERSION = 15.1;
// 피부색·머리색 같은 구성 요소는 혼자서는 반응이 아니다.
const COMPONENT_GROUP = 2;

const groups = messages.groups
  .filter((group) => group.order !== COMPONENT_GROUP)
  .sort((a, b) => a.order - b.order)
  .map((group) => ({ id: group.order, label: group.message }));

const emojis = data
  .filter(
    (entry) =>
      entry.group !== undefined &&
      entry.group !== COMPONENT_GROUP &&
      entry.version <= MAX_VERSION,
  )
  .sort((a, b) => a.order - b.order)
  .map((entry) => ({
    u: entry.emoji,
    l: entry.label,
    g: entry.group,
    ...(entry.tags?.length ? { t: entry.tags } : {}),
  }));

const out = fileURLToPath(
  new URL("../app/shared/lib/emoji/emoji-data.json", import.meta.url),
);
writeFileSync(out, JSON.stringify({ groups, emojis }));
console.log(`${emojis.length} emojis, ${groups.length} groups -> ${out}`);
