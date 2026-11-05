import { useEffect, useState } from "react";
import type { HeraldPoll } from "../model/types";

/** One deadline timer for the screen; resume events catch throttled/background tabs. */
export function usePollClock(polls: HeraldPoll[]) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const refresh = () => setNow(Date.now());
    const deadlines = polls
      .filter(
        (poll) =>
          !poll.closed && poll.closesAt && Date.parse(poll.closesAt) > now,
      )
      .map((poll) => Date.parse(poll.closesAt!));
    const next = Math.min(...deadlines);
    const timer = Number.isFinite(next)
      ? setTimeout(
          refresh,
          Math.min(Math.max(0, next - Date.now()), 2_147_483_647),
        )
      : undefined;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [polls, now]);
  return now;
}
