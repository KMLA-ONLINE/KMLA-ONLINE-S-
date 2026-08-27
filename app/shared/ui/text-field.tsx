import * as React from "react";

import { cn } from "~/shared/lib/utils";
import { Textarea } from "~/shared/ui/textarea";

const FOCUSABLE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

function focusNextControl(control: HTMLTextAreaElement) {
  const controls = control.form
    ? Array.from(control.form.elements).filter(
        (element): element is HTMLElement =>
          element instanceof HTMLElement &&
          element.tabIndex >= 0 &&
          !element.matches(":disabled"),
      )
    : Array.from(
        document.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter(
        (element) => element.tabIndex >= 0 && !element.matches(":disabled"),
      );
  const currentIndex = controls.indexOf(control);

  for (const controlToFocus of controls.slice(currentIndex + 1)) {
    controlToFocus.focus();
    if (document.activeElement === controlToFocus) {
      return;
    }
  }
}

/**
 * `input`은 글자를 내용 상자 안에서 세로 가운데에 놓지만, `textarea`는 첫 줄을 위쪽에
 * 붙인다. 그래서 줄 높이를 내용 상자 높이와 같게 잡아야 `Input`과 나란히 놓았을 때 글자
 * 높이가 맞는다.
 *
 *   h-9 36px − 테두리 2px − py-1 8px = 26px
 *
 * 그냥 두면 `md:text-sm`(줄 높이 20px)에서 글자가 3px 위로 뜬다. 고정값인 이유는 이
 * 컴포넌트가 높이를 `h-9 max-h-9 min-h-9`로 잠그기 때문이다 — 높이나 안쪽 여백을 바꾸면
 * 이 값도 같이 바꿔야 한다.
 *
 * `className`보다 **뒤에** 두어야 한다. `cn`은 tailwind-merge이고, 거기서 글자 크기는
 * 줄 높이와 충돌하는 것으로 다뤄져 뒤에 오는 `text-*` 하나가 앞의 `leading-*`을 지운다.
 * 앞에 두면 `text-base`를 넘기는 호출부에서만 조용히 중앙 정렬이 풀린다.
 */
const LINE_HEIGHT = "leading-[26px]";

/**
 * 한 줄 입력. 높이를 잠그고 넘치는 글자는 가로로 흘리는 `textarea`다.
 *
 * `field-sizing-fixed`는 `Textarea`의 `field-sizing-content`를 지우려는 것인데, 반드시 이
 * 유틸리티 이름으로 적어야 한다. `[field-sizing:fixed]`처럼 임의 속성으로 쓰면
 * tailwind-merge가 임의 속성과 유틸리티를 서로 다른 그룹으로 봐서 둘 다 남기고, 생성된
 * CSS에서는 뒤에 오는 `field-sizing-content`가 이긴다. 그러면 이 필드는 `whitespace-nowrap`인
 * 내용 길이만큼 넓어지려 들어서 — min-content 폭이 곧 글자 전체 폭이 된다 — 필드를 담은
 * grid/flex 칸을 밀어내고, 게시물 제목처럼 긴 값이 들어오면 바깥 레이아웃 폭까지 함께 늘어난다.
 *
 * `min-w-0`은 그 기여를 0으로 잘라 두는 안전장치다. 폭은 부모 칸에 맞춰지고, 넘치는 글자는
 * 이미 있는 가로 스크롤이 받는다.
 */
function TextField({
  className,
  enterKeyHint = "next",
  onBeforeInput,
  onChange,
  onKeyDown,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <Textarea
      {...props}
      aria-multiline={false}
      className={cn(
        "field-sizing-fixed h-9 max-h-9 min-h-9 min-w-0 resize-none [scrollbar-width:none] overflow-x-auto overflow-y-hidden py-1 whitespace-nowrap [&::-webkit-scrollbar]:hidden",
        className,
        LINE_HEIGHT,
      )}
      enterKeyHint={enterKeyHint}
      onBeforeInput={(event) => {
        onBeforeInput?.(event);

        const inputType = (event.nativeEvent as InputEvent).inputType;
        if (
          !event.defaultPrevented &&
          (inputType === "insertLineBreak" || inputType === "insertParagraph")
        ) {
          event.preventDefault();
          if (
            enterKeyHint === "next" &&
            document.activeElement === event.currentTarget
          ) {
            focusNextControl(event.currentTarget);
          }
        }
      }}
      onChange={(event) => {
        const value = event.currentTarget.value.replace(/[\r\n]+/g, "");
        if (value !== event.currentTarget.value) {
          event.currentTarget.value = value;
        }

        onChange?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);

        if (
          !event.defaultPrevented &&
          !event.nativeEvent.isComposing &&
          event.key === "Enter"
        ) {
          event.preventDefault();
          if (enterKeyHint === "next") {
            focusNextControl(event.currentTarget);
          }
        }
      }}
      rows={1}
      wrap="off"
    />
  );
}

export { TextField };
