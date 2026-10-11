import type { Nodes, Parent, Root, Text } from "mdast";
import type { TextDirective } from "mdast-util-directive";
import { directiveFromMarkdown } from "mdast-util-directive";
import type { Handle, Unsafe } from "mdast-util-to-markdown";
import { directive } from "micromark-extension-directive";
import type {
  Construct,
  State,
  TokenizeContext,
  TokenType,
} from "micromark-util-types";
import type { Processor } from "unified";
import type { VFile } from "vfile";

export const UNDERLINE_DIRECTIVE = "u";

const COLON = 58;
const LETTER_U = 117;
const LEFT_BRACKET = 91;

/**
 * 밑줄은 `:u[텍스트]`로 저장한다(`docs/CONTENT_FORMATTING.md`). Markdown에 밑줄 문법이 없어 인라인
 * 지시어를 빌렸는데, 지시어 문법을 그대로 켜면 기존 평문이 다르게 읽힌다.
 *
 * - 지시어 파서는 `:u[`로 시작할 때만 돌린다. `:영문`이면 다 잡는 원래 문법을 켜면
 *   `x:y[링크](https://…)`의 `[링크]`를 지시어 라벨이 먼저 가져가 링크가 깨지고, 이것은 파싱 뒤에
 *   글자로 되돌려도 복구되지 않는다. 줄 머리 `::`·`:::` 블록도 켜지 않는다.
 * - 직렬화에 `remark-directive`의 규칙을 쓰지 않는다. 그 규칙은 글자 앞 `:`를 모두 `\:`로 바꿔
 *   멘션 주소가 `m\:1`이 되고, DB의 `private.parse_mention_ordinals()`가 멘션을 놓친다. 그래서
 *   밑줄로 읽힐 `:u[`만 escape한다.
 */
export function remarkPostUnderline(this: Processor) {
  const data = this.data();
  (data.micromarkExtensions ??= []).push({
    text: { [COLON]: underlineDirective },
  });
  (data.fromMarkdownExtensions ??= []).push(directiveFromMarkdown());
  (data.toMarkdownExtensions ??= []).push({
    handlers: { textDirective: handleUnderline },
    unsafe: underlineUnsafe,
  });
  return (tree: Root, file: VFile) => {
    markUnderlines(tree, String(file.value ?? ""));
  };
}

const directiveText = directive().text?.[COLON] as Construct;

/** `:u[`를 미리 본 다음에만 원래 지시어 파서를 돌린다. */
const underlineDirective: Construct = {
  name: "underlineDirective",
  previous: directiveText.previous,
  tokenize(this: TokenizeContext, effects, ok, nok) {
    const parse = directiveText.tokenize.call(this, effects, ok, nok);
    return (code) => effects.check(underlineOpening, parse, nok)(code);
  },
};

const underlineOpening: Construct = {
  partial: true,
  tokenize(effects, ok, nok) {
    const probe = "underlineOpening" as TokenType;
    const expect =
      (expected: number, next: State): State =>
      (code) => {
        if (code !== expected) return nok(code);
        effects.consume(code);
        return next;
      };
    const done: State = (code) => {
      effects.exit(probe);
      return ok(code);
    };
    return (code) => {
      effects.enter(probe);
      return expect(COLON, expect(LETTER_U, expect(LEFT_BRACKET, done)))(code);
    };
  },
};

const underlineUnsafe: Unsafe[] = [
  {
    character: ":",
    after: `${UNDERLINE_DIRECTIVE}\\[`,
    inConstruct: "phrasing",
  },
];

const handleUnderline: Handle = (node: TextDirective, _, state, info) => {
  const tracker = state.createTracker(info);
  const exit = state.enter("label");
  let value = tracker.move(`:${UNDERLINE_DIRECTIVE}[`);
  value += tracker.move(
    state.containerPhrasing(node, {
      ...tracker.current(),
      before: value,
      after: "]",
    }),
  );
  value += tracker.move("]");
  exit();
  // 바로 뒤 글자가 `{`이면 지시어 속성으로 읽히므로 빈 속성으로 막는다.
  if (info.after.startsWith("{")) value += tracker.move("{}");
  return value;
};

/** 밑줄을 HTML `<u>`로 그리도록 표시한다. 속성(`{…}`)은 버리고, 라벨이 빈 `:u[]`는 원문 글자로 둔다. */
function markUnderlines(node: Nodes, source: string): void {
  if (!("children" in node)) return;
  const parent = node as Parent;
  parent.children = parent.children.map((child) => {
    markUnderlines(child, source);
    if (child.type !== "textDirective") return child;
    if (child.children.length === 0) return text(slice(source, child));
    child.attributes = {};
    child.data = { hName: "u" };
    return child;
  });
}

function text(value: string): Text {
  return { type: "text", value };
}

function slice(source: string, node: Nodes): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined
    ? ""
    : source.slice(start, end);
}
