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
  htmlAttr,
  htmlSchema,
  linkAttr,
  linkSchema,
  paragraphAttr,
  paragraphSchema,
  remarkHtmlTransformer,
  remarkLineBreak,
  remarkPreserveEmptyLinePlugin,
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
import { useEffect, useRef } from "react";

import {
  fromPostEditorMarkdown,
  isSafePostLink,
  sanitizePostMarkdown,
  toMilkdownMarkdown,
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
  htmlAttr,
  htmlSchema,
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
  remarkLineBreak,
  remarkHtmlTransformer,
  remarkPreserveEmptyLinePlugin,
].flat();

const imeSafeShortcuts = $prose(
  (ctx) =>
    new Plugin({
      props: {
        attributes: {
          "aria-label": "본문",
          "data-placeholder": "본문을 입력하세요",
        },
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
  onValueChange,
}: {
  initialValue: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <MilkdownProvider>
      <EditorSurface
        initialValue={initialValue}
        onValueChange={onValueChange}
      />
    </MilkdownProvider>
  );
}

function EditorSurface({
  initialValue,
  onValueChange,
}: {
  initialValue: string;
  onValueChange?: (value: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const lastValue = useRef(
    toMilkdownMarkdown(sanitizePostMarkdown(initialValue)),
  );
  const onValueChangeRef = useRef(onValueChange);
  useEffect(() => {
    onValueChangeRef.current = onValueChange;
  }, [onValueChange]);
  const { get } = useEditor(
    (root) =>
      MilkdownEditor.make()
        .config((ctx) => {
          ctx.set(rootCtx, root);
          ctx.set(defaultValueCtx, lastValue.current);
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            const safe = sanitizePostMarkdown(fromPostEditorMarkdown(markdown));
            if (input.current) input.current.value = safe;
            onValueChangeRef.current?.(safe);
          });
        })
        .use(markdownSchema)
        .use(history)
        .use(imeSafeShortcuts)
        .use(listener),
    [],
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

  const tools: {
    label: string;
    keys?: string;
    icon: React.ReactNode;
    run: () => void;
  }[] = [
    {
      label: "굵게",
      keys: "Control+B Meta+B",
      icon: <BoldIcon />,
      run: () => run(callCommand(toggleStrongCommand.key)),
    },
    {
      label: "기울임",
      keys: "Control+I Meta+I",
      icon: <ItalicIcon />,
      run: () => run(callCommand(toggleEmphasisCommand.key)),
    },
    {
      label: "취소선",
      keys: "Control+Shift+X Meta+Shift+X",
      icon: <StrikethroughIcon />,
      run: () => run(callCommand(toggleStrikethroughCommand.key)),
    },
    {
      label: "큰 제목",
      icon: <Heading2Icon />,
      run: () => run(callCommand(wrapInHeadingCommand.key, 2)),
    },
    {
      label: "작은 제목",
      icon: <Heading3Icon />,
      run: () => run(callCommand(wrapInHeadingCommand.key, 3)),
    },
    { label: "링크", icon: <LinkIcon />, run: link },
    {
      label: "실행 취소",
      keys: "Control+Z Meta+Z",
      icon: <Undo2Icon />,
      run: () => run(callCommand(undoCommand.key)),
    },
    {
      label: "다시 실행",
      keys: "Control+Shift+Z Meta+Shift+Z",
      icon: <Redo2Icon />,
      run: () => run(callCommand(redoCommand.key)),
    },
  ];

  return (
    <div className="overflow-hidden rounded-md border bg-background">
      <input
        ref={input}
        type="hidden"
        name="body"
        defaultValue={sanitizePostMarkdown(initialValue)}
      />
      {/*
        툴바는 Tab 순서에서 뺀다. 제목에서 Tab을 누르면 서식 버튼 여덟 개를 지나는 게 아니라
        본문으로 바로 가야 한다. 서식은 포인터로 누르거나 `aria-keyshortcuts`에 적힌 단축키로
        적용한다.
      */}
      <div
        className="flex flex-wrap gap-1 border-b bg-muted/50 p-1"
        role="toolbar"
        aria-label="본문 서식"
      >
        {tools.map((tool) => (
          <Tool
            key={tool.label}
            label={tool.label}
            keys={tool.keys}
            onClick={tool.run}
          >
            {tool.icon}
          </Tool>
        ))}
      </div>
      <div
        className="post-typography h-96 overflow-y-auto"
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
      tabIndex={-1}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
