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
 */
const LINE_HEIGHT = "leading-[26px]";

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
        "[field-sizing:fixed] h-9 max-h-9 min-h-9 resize-none [scrollbar-width:none] overflow-x-auto overflow-y-hidden py-1 whitespace-nowrap [&::-webkit-scrollbar]:hidden",
        LINE_HEIGHT,
        className,
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
