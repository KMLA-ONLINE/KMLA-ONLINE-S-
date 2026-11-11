import { useEffect, useState } from "react";

import { loadGongangManagers } from "../data/gongang-schedule";
import { cn } from "~/shared/lib/utils";

/** 공강 관리 권한을 받은 사람을 안내한다. 명단이 비었거나 불러오지 못하면 줄을 숨긴다. */
export function GongangManagers({ className }: { className?: string }) {
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

  if (!names.length) return null;

  return (
    <p className={cn("px-1 text-sm text-muted-foreground", className)}>
      <span className="font-medium text-foreground">공강관리자:</span>{" "}
      {names.join(", ")}
    </p>
  );
}
