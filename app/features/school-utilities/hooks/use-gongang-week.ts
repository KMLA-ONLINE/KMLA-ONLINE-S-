import { useCallback, useEffect, useState } from "react";

import {
  loadGongangSchedule,
  type GongangScheduleEntry,
} from "../data/gongang-schedule";
import {
  loadUtilityReservations,
  type UtilityReservation,
} from "../data/reservations";

/**
 * One week of student reservations and manager prebookings, shared by the
 * booking and prebooking screens.
 *
 * Only the first load shows a spinner. Later refreshes (focus, after a
 * mutation, retry) keep the board on screen so the floor, selection and scroll
 * position stay where the user left them.
 */
export function useGongangWeek(
  weekStart: string,
  weekEnd: string,
  enabled = true,
) {
  const [reservations, setReservations] = useState<UtilityReservation[]>([]);
  const [schedules, setSchedules] = useState<GongangScheduleEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void Promise.all([
      loadUtilityReservations("gongang", weekStart, weekEnd),
      loadGongangSchedule(weekStart, weekEnd),
    ])
      .then(([nextReservations, nextSchedules]) => {
        if (!active) return;
        setReservations(nextReservations);
        setSchedules(nextSchedules);
        setLoadFailed(false);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      })
      .finally(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [enabled, weekStart, weekEnd, version]);

  return {
    reservations,
    schedules,
    loading: enabled && !loaded,
    loadFailed,
    refresh,
  };
}
