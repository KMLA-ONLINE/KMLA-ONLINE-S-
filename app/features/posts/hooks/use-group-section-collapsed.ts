import { useCallback, useState } from "react";

import {
  readGroupSectionCollapsed,
  writeGroupSectionCollapsed,
  type GroupPostSection,
} from "~/features/posts/model/section-collapse";

/**
 * 대표·고정 섹션의 접힘. 기기 취향이라 `localStorage`에 살고 그룹별로 기억한다.
 * 섹션은 한 화면에 하나씩이라 보기 방식처럼 store를 구독하지 않고 마운트 때 한 번 읽는다.
 */
export function useGroupSectionCollapsed(
  groupId: string,
  section: GroupPostSection,
): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsed] = useState(() =>
    readGroupSectionCollapsed(groupId, section),
  );
  const update = useCallback(
    (next: boolean) => {
      setCollapsed(next);
      writeGroupSectionCollapsed(groupId, section, next);
    },
    [groupId, section],
  );
  return [collapsed, update];
}
