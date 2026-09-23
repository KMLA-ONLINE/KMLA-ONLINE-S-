// public/logo.svg에서 파생되는 두 장의 브랜드 에셋을 만든다.
//
// `pwa:assets`(pwa-assets.config.ts)가 만드는 홈 화면 아이콘과는 쓰임이 달라 생성기가
// 갈라져 있다. 저쪽은 정사각 앱 아이콘만 뽑고, 여기 둘은 각각 알파 실루엣과 1200x630
// 캔버스라 preset이 표현하지 못한다.
//
//  - badge-96x96.png  : Android 상태바 badge. OS가 알파 채널만 읽어 단색으로 칠하므로
//                       네이비 배경판을 걷어내고 마크의 실루엣만 남긴다. 배경이 남으면
//                       상태바에 흰 사각형 하나가 뜬다.
//  - og-image.png     : 카카오톡·디스코드 링크 카드. 1.91:1 밖은 잘리므로 마크를 가운데
//                       두고 여백을 넉넉히 준다.
//
// 원본 로고를 갈아끼웠다면 `npm run brand:assets`로 둘 다 다시 만든다.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import sharp from "sharp";

/** logo.svg 배지 색. pwa-assets.config.ts의 BRAND_NAVY와 같아야 한다. */
const BRAND_NAVY = "#01234c";
const BADGE_SIZE = 96;
const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
/** OG 캔버스 안 마크 크기. 1.91:1 카드가 잘려도 남을 만큼 가운데로 모은다. */
const OG_MARK = 320;

const publicDir = resolve(process.cwd(), "public");
const read = (name) => readFileSync(resolve(publicDir, name), "utf8");
const write = (name) => resolve(publicDir, name);

/**
 * 배경 판을 걷어낸 마크. logo-notext.svg는 `<rect>` 한 장 위에 흰 path를 얹은 구조라
 * 그 한 줄만 지우면 알파가 곧 마크 모양이 된다. 구조가 바뀌어 rect가 사라지면 조용히
 * 배경 있는 badge가 나가므로 여기서 끊는다.
 */
function markOnly() {
  const source = read("logo-notext.svg");
  const stripped = source.replace(/\s*<rect[^>]*\/>/, "");
  if (stripped === source) {
    throw new Error(
      "logo-notext.svg에서 배경 <rect>를 찾지 못했습니다. badge가 투명 배경이 아니게 됩니다.",
    );
  }
  return Buffer.from(stripped);
}

// 알파만 남기고 색은 흰색으로 통일한다. 원본 path에 흰색이 아닌 fill이 섞여 있어도
// badge는 단색이어야 하므로 여기서 한 번 덮는다.
await sharp(markOnly(), { density: 384 })
  .resize(BADGE_SIZE, BADGE_SIZE, {
    fit: "contain",
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  })
  .composite([
    {
      input: {
        create: {
          width: BADGE_SIZE,
          height: BADGE_SIZE,
          channels: 4,
          background: "#ffffff",
        },
      },
      blend: "in",
    },
  ])
  .png()
  .toFile(write("badge-96x96.png"));

const mark = await sharp(Buffer.from(read("logo.svg")), { density: 384 })
  .resize(OG_MARK, OG_MARK, { fit: "contain" })
  .png()
  .toBuffer();

await sharp({
  create: {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    channels: 4,
    background: BRAND_NAVY,
  },
})
  .composite([{ input: mark, gravity: "centre" }])
  .png()
  .toFile(write("og-image.png"));

console.log("[brand] wrote public/badge-96x96.png, public/og-image.png");
