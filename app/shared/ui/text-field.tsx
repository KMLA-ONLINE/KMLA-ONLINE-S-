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
