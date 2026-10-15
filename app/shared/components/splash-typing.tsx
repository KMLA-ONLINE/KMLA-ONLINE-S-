import { typingFrames } from "~/shared/lib/hangul-typing";

/**
 * 첫 로딩 화면 가운데에 글자가 한 타씩 쳐지는 작은 장난.
 *
 * 평소에는 "KMLA Online"이 찍히고, 가끔 한글 문구가 자모 단위로 조합되며 찍힌다.
 * 로딩은 금방 끝나므로 다 쳐지기 전에 사라지는 게 보통이다 — 일부러 붙잡지 않는다.
 *
 * 이 화면은 프리렌더된 정적 HTML이라 렌더 중에 시각·난수로 고르면 하이드레이션이 어긋난다.
 * 그래서 문구는 전부 그려 두고, `<head>`의 {@link SplashTypingScript}가 `<html data-splash>`에
 * 하나를 찍으면 CSS가 그것만 보여 준다. 애니메이션도 CSS라 JS를 받기 전부터 돈다.
 * 이스터에그 문구는 다 쳐질 때까지 기다려 준다({@link waitForSplashEgg}).
 *
 * 고르는 순서는 연타 → 희귀 → 새벽 → 기본이다. 연타가 앞이라 새로고침을 몰아쳐서 희귀
 * 문구를 뽑을 수는 없다.
 */
const VARIANTS = {
  default: "KMLA Online",
  // 2초 안에 연달아 세 번째 새로고침부터
  spam: "그만 눌러요",
  // 0.01%
  legend: "0.01%!",
  // 0.1%
  rare: "0.1%!",
  // 1%
  credit: "과학기술부 제작",
  // 3시~5시(3:00–4:59)에 10%
  dawn: "안 자시나요?",
} as const;

type Variant = keyof typeof VARIANTS;

// 프리렌더와 대기 계산이 같은 프레임을 쓰도록 한 번만 만든다.
const FRAMES = Object.fromEntries(
  Object.entries(VARIANTS).map(([key, text]) => [key, typingFrames(text)]),
) as Record<Variant, string[]>;

const STORAGE_KEY = "splash-reloads";

// 첫 페인트 전에 돌아야 하므로 문자열로 넣는다. 저장소가 막혀도 시각·확률 문구는 고른다.
// 희귀 문구는 난수 하나를 앞에서부터 잘라 쓰므로, 경계를 누적값(0.01%, +0.1%, +1%)으로 둔다.
const SCRIPT = `(function(){var n=1;try{var s=sessionStorage,now=Date.now(),e=performance.getEntriesByType("navigation")[0],p=JSON.parse(s.getItem("${STORAGE_KEY}")||"null");if(e&&e.type==="reload"&&p&&now-p.at<2000)n=p.n+1;s.setItem("${STORAGE_KEY}",JSON.stringify({n:n,at:now}))}catch(_){}var h=new Date().getHours(),r=Math.random();document.documentElement.dataset.splash=n>=3?"spam":r<1e-4?"legend":r<1.1e-3?"rare":r<1.11e-2?"credit":h>=3&&h<5&&Math.random()<0.1?"dawn":"default"})()`;

export function SplashTypingScript() {
  return <script dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}

// 기본 문구가 보통 로딩(0.3~0.5초) 안에 거의 다 쳐지도록 빠르게 친다.
const STEP_MS = 45;
const START_MS = 120;
// 다 쳐진 뒤 읽을 틈.
const READ_MS = 400;

/**
 * 이스터에그 문구가 나왔으면 다 쳐지고 읽힐 때까지 첫 화면을 붙잡는다. 반쯤 쳐지다 사라지면
 * 뭘 봤는지 모르기 때문이다. 기본 문구는 붙잡지 않는다 — 매번 기다리게 되면 금방 거슬린다.
 *
 * 남은 시간만큼만 기다리므로 로딩이 원래 길었다면 더 늦어지지 않는다. 애니메이션은 첫
 * 페인트부터 돌았으니 그 시각을 기준으로 잰다. 설치된 PWA는 글자 대신 로고를 그리므로 제외.
 */
export async function waitForSplashEgg(): Promise<void> {
  const variant = document.documentElement.dataset.splash;
  if (!variant || variant === "default" || !(variant in VARIANTS)) return;
  if (window.matchMedia("(display-mode: standalone)").matches) return;

  // 움직임 줄이기에서는 완성된 글자가 바로 보이므로 읽을 틈만 준다.
  const typing = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? 0
    : START_MS + FRAMES[variant as Variant].length * STEP_MS;
  const paint = performance.getEntriesByType("paint")[0]?.startTime;
  const start = paint ?? performance.now();
  const end = start + typing + READ_MS;
  const remaining = end - performance.now();
  if (remaining > 0) {
    await new Promise((resolve) => setTimeout(resolve, remaining));
  }
}

const CSS = `
[data-splash-variant]{display:none}
${(Object.keys(VARIANTS) as Variant[])
  .map((v) => `:root[data-splash="${v}"] [data-splash-variant="${v}"]`)
  .concat(':root:not([data-splash]) [data-splash-variant="default"]')
  .join(",")}{display:inline-grid}
.splash-frame{grid-area:1/1;white-space:pre-wrap;visibility:hidden;animation:splash-frame ${STEP_MS}ms step-end calc(${START_MS}ms + var(--i) * ${STEP_MS}ms)}
.splash-frame:last-child{animation-fill-mode:forwards}
.splash-caret{display:inline-block;width:2px;height:1em;margin-left:2px;vertical-align:-0.12em;background:currentColor;animation:splash-caret 1s step-end infinite}
@keyframes splash-frame{from,to{visibility:visible}}
@keyframes splash-caret{50%{opacity:0}}
@media (prefers-reduced-motion:reduce){.splash-frame{animation:none}.splash-frame:last-child{visibility:visible}.splash-caret{animation:none}}
`;

export function SplashTyping() {
  return (
    // 문구는 장식이다.
    <div
      aria-hidden
      className="px-4 text-2xl font-semibold tracking-tight text-muted-foreground/70"
    >
      <style dangerouslySetInnerHTML={{ __html: CSS }} />
      {(Object.entries(FRAMES) as [Variant, string[]][]).map(
        ([key, frames]) => (
          <span
            key={key}
            data-splash-variant={key}
            className="justify-items-start"
          >
            {frames.map((frame, i) => (
              <span
                key={i}
                className="splash-frame"
                style={{ "--i": i } as React.CSSProperties}
              >
                {frame}
                {/* 프레임마다 너비가 달라 커서가 글자 끝을 따라가려면 프레임 안에 있어야 한다. */}
                <span className="splash-caret" />
              </span>
            ))}
          </span>
        ),
      )}
    </div>
  );
}
