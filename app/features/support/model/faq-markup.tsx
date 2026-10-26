import type { ReactNode } from "react";
import { Link } from "react-router";

/**
 * 도움말 답변은 한 문장 전체가 번역 키라서 JSX 대신 문자열로 둔다. 링크는 `[글자](/경로)`,
 * 강조는 `**글자**`만 알아듣는다 — Markdown 파서를 끌어오지 않고, 영어 번역이 어순을 바꿔도
 * 링크와 강조가 문장 안에서 제자리를 찾는다.
 */
const TOKEN = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;

export function renderFaqAnswer(answer: string): ReactNode {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of answer.matchAll(TOKEN)) {
    const index = match.index;
    if (index > last) nodes.push(answer.slice(last, index));
    const [, linkText, to, bold] = match;
    if (linkText !== undefined && to !== undefined) {
      nodes.push(
        <Link key={index} to={to}>
          {linkText}
        </Link>,
      );
    } else if (bold !== undefined) {
      nodes.push(<b key={index}>{bold}</b>);
    }
    last = index + match[0].length;
  }
  if (last < answer.length) nodes.push(answer.slice(last));
  return nodes.length === 1 ? nodes[0] : nodes;
}
