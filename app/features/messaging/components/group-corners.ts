/** 묶음 안에서 위·아래 조각과 맞닿는지. 글 버블, 사진 격자, 파일·오디오·게시물 카드가 모두 조각이다. */
export interface GroupJoin {
  above: boolean;
  below: boolean;
}

/**
 * 맞닿는 쪽의 보낸 사람 쪽 모서리만 덜 둥글게 해 묶음을 하나로 잇는다. `rounded-2xl` 뒤에 붙인다.
 */
export function groupCornerClass(isOwn: boolean, { above, below }: GroupJoin) {
  return [
    above && (isOwn ? "rounded-tr-md" : "rounded-tl-md"),
    below && (isOwn ? "rounded-br-md" : "rounded-bl-md"),
  ]
    .filter(Boolean)
    .join(" ");
}
