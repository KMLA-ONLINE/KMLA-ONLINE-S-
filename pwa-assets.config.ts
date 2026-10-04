import {
  defineConfig,
  minimal2023Preset,
} from "@vite-pwa/assets-generator/config";

// public/logo.svg는 public/KMLA_logo.svg(원본 마크)를 512px 배지로 감싼 앱 아이콘이다.
// 원본을 갈아끼웠다면 logo.svg를 다시 만든 뒤 `npm run pwa:assets`로 아이콘을 재생성한다.

/** logo.svg 배지 색. maskable 여백이 배지와 이어지려면 같은 값이어야 한다. */
const BRAND_NAVY = "#01234c";

export default defineConfig({
  headLinkOptions: {
    preset: "2023",
  },
  preset: {
    ...minimal2023Preset,
    // 안드로이드는 maskable 아이콘을 원형/스퀘어클로 잘라내므로 여백까지 브랜드 색으로
    // 채운다. generateMaskableAsset의 기본 배경이 흰색이라, 그냥 두면 네이비 배지
    // 바깥에 흰 링이 남는다.
    maskable: {
      ...minimal2023Preset.maskable,
      resizeOptions: {
        ...minimal2023Preset.maskable.resizeOptions,
        background: BRAND_NAVY,
      },
    },
    // apple-touch-icon도 같은 이유로 불투명 배경을 깐다. iOS는 마스킹은 안 하지만
    // 기본 흰 배경이면 홈 화면에서 흰 타일 안에 네이비 배지가 박힌 모양이 된다.
    apple: {
      ...minimal2023Preset.apple,
      resizeOptions: {
        ...minimal2023Preset.apple.resizeOptions,
        background: BRAND_NAVY,
      },
    },
  },
  images: ["public/logo.svg"],
});
