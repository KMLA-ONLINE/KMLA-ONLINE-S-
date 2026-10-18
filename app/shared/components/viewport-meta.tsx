// iOS needs cover for safe-area padding. Keep Android Chrome 135+ out of edge-to-edge
// layout: its tab-bar background otherwise draws behind the system navigation bar.
// Runs in the parsed head, not during React rendering (the SPA shell is built in Node).
const INIT_VIEWPORT = `(() => {
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  const viewport = document.querySelector('meta[name="viewport"]');
  if (ios) {
    viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
  } else if (/Android/.test(navigator.userAgent)) {
    // Resize the layout natively; fixed chat/dialog containers then follow the keyboard
    // without adding a second visual-viewport offset. Preserve Android's system-bar inset.
    viewport.content = 'width=device-width, initial-scale=1, interactive-widget=resizes-content';
  }
})();`;

export function ViewportMeta() {
  return (
    <>
      {/* Empty itemProp opts out of React metadata hoisting/content matching.
          iOS changes content before hydration; adopt that node without adding a second meta. */}
      <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
        itemProp=""
        suppressHydrationWarning
      />
      <script dangerouslySetInnerHTML={{ __html: INIT_VIEWPORT }} />
    </>
  );
}
