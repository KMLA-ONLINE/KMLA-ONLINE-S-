import { useEffect, useState } from "react";

import { loadGongangManagers } from "../data/gongang-schedule";
import { cn } from "~/shared/lib/utils";

/** 공강 관리 권한을 받은 사람. 불러오지 못하면 빈 명단으로 두어 안내를 숨긴다. */
export function useGongangManagers() {
  const [names, setNames] = useState<string[]>([]);

  useEffect(() => {
    let active = true;
    void loadGongangManagers()
      .then((value) => {
        if (active) setNames(value);
      })
      .catch((error: unknown) => {
        console.error("Failed to load gongang managers", error);
      });
    return () => {
      active = false;
    };
  }, []);

  return names;
}

export function GongangManagers({
  names,
  className,
}: {
  names: string[];
  className?: string;
}) {
  if (!names.length) return null;

  return (
    <p className={cn("px-1 text-sm text-muted-foreground", className)}>
      <span className="font-medium text-foreground">공강관리자:</span>{" "}
      {names.join(", ")}
    </p>
  );
}
