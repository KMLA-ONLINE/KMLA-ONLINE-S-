import { useEffect, useState } from "react";

import {
  loadGongangManagers,
  type GongangManager,
} from "../data/gongang-schedule";

/** 공강 관리 권한을 받은 사람. 불러오지 못하면 빈 명단으로 끝나 안내를 숨긴다. */
export function useGongangManagers() {
  const [managers, setManagers] = useState<GongangManager[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    void loadGongangManagers()
      .then((value) => {
        if (active) setManagers(value);
      })
      .catch((error: unknown) => {
        console.error("Failed to load gongang managers", error);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  return { managers, loaded };
}
