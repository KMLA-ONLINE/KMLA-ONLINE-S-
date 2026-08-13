import {
  defaultValueCtx,
  Editor as MilkdownEditor,
  rootCtx,
} from "@milkdown/core";
import { history, redoCommand, undoCommand } from "@milkdown/plugin-history";
import { listener, listenerCtx } from "@milkdown/plugin-listener";
import {
  docSchema,
  emphasisAttr,
  emphasisSchema,
  hardbreakAttr,
  hardbreakSchema,
  headingAttr,
  headingIdGenerator,
  headingSchema,
  linkAttr,
  linkSchema,
  paragraphAttr,
  paragraphSchema,
  strongAttr,
  strongSchema,
  textSchema,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInHeadingCommand,
} from "@milkdown/preset-commonmark";
import {
  remarkGFMPlugin,
  strikethroughAttr,
  strikethroughSchema,
  toggleStrikethroughCommand,
} from "@milkdown/preset-gfm";
import { Milkdown, MilkdownProvider, useEditor } from "@milkdown/react";
import { toggleMark } from "@milkdown/prose/commands";
import { redo, undo } from "@milkdown/prose/history";
import { Plugin } from "@milkdown/prose/state";
import { $prose, callCommand } from "@milkdown/utils";
import {
  BoldIcon,
  Heading2Icon,
  Heading3Icon,
  ItalicIcon,
  LinkIcon,
  Redo2Icon,
  StrikethroughIcon,
  Undo2Icon,
} from "lucide-react";
import { useRef } from "react";

import {
  isSafePostLink,
  sanitizePostMarkdown,
} from "~/features/posts/model/markdown";
import { Button } from "~/shared/ui/button";

const markdownSchema = [
  docSchema,
  paragraphAttr,
  paragraphSchema,
  headingIdGenerator,
  headingAttr,
  headingSchema,
  hardbreakAttr,
  hardbreakSchema,
  emphasisAttr,
  emphasisSchema,
  strongAttr,
  strongSchema,
  linkAttr,
  linkSchema,
  toggleEmphasisCommand,
  toggleLinkCommand,
  toggleStrongCommand,
  wrapInHeadingCommand,
  strikethroughAttr,
  strikethroughSchema,
  toggleStrikethroughCommand,
  textSchema,
  remarkGFMPlugin,
].flat();

const imeSafeShortcuts = $prose(
  (ctx) =>
    new Plugin({
      props: {
        handleKeyDown(view, event) {
          if (event.isComposing || view.composing || event.keyCode === 229)
            return false;

          const mod = event.ctrlKey || event.metaKey;
          if (!mod || event.altKey) return false;
          const key = event.key.toLowerCase();

          if (key === "b" && !event.shiftKey)
            return toggleMark(strongSchema.type(ctx))(
              view.state,
              view.dispatch,
              view,
            );
          if (key === "i" && !event.shiftKey)
            return toggleMark(emphasisSchema.type(ctx))(
              view.state,
              view.dispatch,
              view,
            );
          if (key === "x" && event.shiftKey)
            return toggleMark(strikethroughSchema.type(ctx))(
              view.state,
              view.dispatch,
              view,
            );
          if (key === "z" && !event.shiftKey)
            return undo(view.state, view.dispatch, view);
          if (key === "y" || (key === "z" && event.shiftKey))
            return redo(view.state, view.dispatch, view);
          return false;
        },
      },
    }),
);

export default function DesktopMarkdownEditor({
  initialValue,
}: {
  initialValue: string;
}) {
  return (
    <MilkdownProvider>
      <EditorSurface initialValue={initialValue} />
    </MilkdownProvider>
  );
}

function EditorSurface({ initialValue }: { initialValue: string }) {
  const input = useRef<HTMLInputElement>(null);
  const lastValue = useRef(sanitizePostMarkdown(initialValue));
  const { get } = useEditor(
    (root) =>
      MilkdownEditor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, lastValue.current);
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            const safe = sanitizePostMarkdown(markdown);
            lastValue.current = safe;
            if (input.current) input.current.value = safe;
          });
        })
        .use(markdownSchema)
        .use(history)
        .use(imeSafeShortcuts)
        .use(listener),
    [initialValue],
  );

  const run = (
    command: Parameters<NonNullable<ReturnType<typeof get>>["action"]>[0],
  ) => {
    get()?.action(command);
  };
  const link = () => {
    const value = window.prompt("링크 URL (https:// 또는 http://)");
    if (!value) return;
    if (!isSafePostLink(value)) {
      window.alert("절대 HTTP(S) 주소만 사용할 수 있습니다.");
      return;
    }
    run(callCommand(toggleLinkCommand.key, { href: value }));
  };

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <input
        ref={input}
        type="hidden"
        name="body"
        defaultValue={sanitizePostMarkdown(initialValue)}
      />
      <div
        className="flex flex-wrap gap-1 border-b p-1"
        role="toolbar"
        aria-label="본문 서식"
      >
        <Tool
          label="굵게"
          keys="Control+B Meta+B"
          onClick={() => run(callCommand(toggleStrongCommand.key))}
        >
          <BoldIcon />
        </Tool>
        <Tool
          label="기울임"
          keys="Control+I Meta+I"
          onClick={() => run(callCommand(toggleEmphasisCommand.key))}
        >
          <ItalicIcon />
        </Tool>
        <Tool
          label="취소선"
          keys="Control+Shift+X Meta+Shift+X"
          onClick={() => run(callCommand(toggleStrikethroughCommand.key))}
        >
          <StrikethroughIcon />
        </Tool>
        <Tool
          label="큰 제목"
          onClick={() => run(callCommand(wrapInHeadingCommand.key, 2))}
        >
          <Heading2Icon />
        </Tool>
        <Tool
          label="작은 제목"
          onClick={() => run(callCommand(wrapInHeadingCommand.key, 3))}
        >
          <Heading3Icon />
        </Tool>
        <Tool label="링크" onClick={link}>
          <LinkIcon />
        </Tool>
        <Tool
          label="실행 취소"
          keys="Control+Z Meta+Z"
          onClick={() => run(callCommand(undoCommand.key))}
        >
          <Undo2Icon />
        </Tool>
        <Tool
          label="다시 실행"
          keys="Control+Shift+Z Meta+Shift+Z"
          onClick={() => run(callCommand(redoCommand.key))}
        >
          <Redo2Icon />
        </Tool>
      </div>
      <div
        className="post-typography min-h-72"
        role="presentation"
        onClick={(event) => {
          if (!(event.ctrlKey || event.metaKey)) return;
          const anchor = (event.target as HTMLElement).closest("a");
          if (
            anchor instanceof HTMLAnchorElement &&
            isSafePostLink(anchor.href)
          ) {
            event.preventDefault();
            window.open(anchor.href, "_blank", "noopener,noreferrer");
          }
        }}
      >
        <Milkdown />
      </div>
    </div>
  );
}

function Tool({
  label,
  keys,
  onClick,
  children,
}: {
  label: string;
  keys?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      aria-label={label}
      aria-keyshortcuts={keys}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
