import {
  defaultValueCtx,
  Editor as MilkdownEditor,
  editorViewCtx,
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
import { useEffect, useImperativeHandle, useRef, type RefObject } from "react";

import {
  fromPostEditorMarkdown,
  isSafePostLink,
  sanitizePostMarkdown,
  toMilkdownMarkdown,
} from "~/features/posts/model/markdown";
import type { PostBodyInputHandle } from "~/features/posts/components/editor/post-body-input";
import { sanitizeMentionLabel } from "~/features/posts/model/mentions";
import { cn } from "~/shared/lib/utils";
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
  handleRef,
  className,
}: {
  initialValue: string;
  onValueChange?: (value: string) => void;
  handleRef?: RefObject<PostBodyInputHandle | null>;
  className?: string;
}) {
  return (
    <MilkdownProvider>
      <EditorSurface
        initialValue={initialValue}
        onValueChange={onValueChange}
        handleRef={handleRef}
        className={className}
      />
    </MilkdownProvider>
  );
}

function EditorSurface({
  initialValue,
  onValueChange,
  handleRef,
  className,
}: {
  initialValue: string;
  onValueChange?: (value: string) => void;
  handleRef?: RefObject<PostBodyInputHandle | null>;
  className?: string;
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

  // 멘션은 저장 형식이 CommonMark 링크라(`model/mentions.ts`) 편집기에도 링크 mark 로 넣는다.
  // Markdown 원문을 글자로 흘려 넣으면 WYSIWYG 이 그것을 링크로 다시 읽지 않아 `[@이름](m:1)`이
  // 그대로 보인다.
  useImperativeHandle(
    handleRef,
    () => ({
      insertMention(label: string, ordinal: number) {
        get()?.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          const { state, dispatch } = view;
          const mark = linkSchema.type(ctx).create({ href: `m:${ordinal}` });
          const mention = state.schema.text(`@${sanitizeMentionLabel(label)}`, [
            mark,
          ]);
          // 뒤에 이어 쓸 때 링크 안으로 빨려 들어가지 않도록 mark 없는 공백을 함께 넣는다.
          const trailing = state.schema.text(" ");
          const { from, to } = state.selection;
          dispatch(state.tr.replaceWith(from, to, [mention, trailing]));
          view.focus();
        });
      },
    }),
    [get],
  );
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
    <div
      className={cn(
        "flex h-[clamp(18rem,50dvh,32rem)] flex-none flex-col overflow-hidden rounded-md border bg-background md:h-auto",
        className,
      )}
    >
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
        className="flex shrink-0 flex-nowrap gap-1 overflow-x-auto border-b bg-muted/50 p-1"
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
      {/*
        본문 영역의 높이는 편집기가 스스로 정한다. 모바일은 바깥 상자의 `clamp` 높이를 flex로
        나눠 갖고, 데스크톱은 내용을 따라 자라다 상한에서 멈춘다. 데스크톱을 예전처럼 고정
        높이로 두면 짧은 글에도 열 줄짜리 창 안에서 글을 쓰게 되고, 페이지 스크롤 안에 편집기
        스크롤이 하나 더 생긴다. 반대로 상한을 없애면 긴 글에서 첨부 영역이 화면 밖으로 밀린다.
      */}
      <div
        className="post-typography flex min-h-0 flex-1 flex-col overflow-y-auto md:h-auto md:max-h-[min(60dvh,40rem)] md:min-h-72 md:flex-none"
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
