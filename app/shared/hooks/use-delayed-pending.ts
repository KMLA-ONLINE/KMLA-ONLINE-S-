import { useEffect, useRef, useState } from "react";

export function useDelayedPending(
  pending: boolean,
  { delay = 200, minimum = 300 }: { delay?: number; minimum?: number } = {},
) {
  const [visible, setVisible] = useState(false);
  const visibleSinceRef = useRef<number | null>(null);

  useEffect(() => {
    if (pending) {
      if (visible) return;
      const timer = window.setTimeout(() => {
        visibleSinceRef.current = Date.now();
        setVisible(true);
      }, delay);
      return () => window.clearTimeout(timer);
    }

    if (!visible || visibleSinceRef.current === null) return;

    const elapsed = Date.now() - visibleSinceRef.current;
    const timer = window.setTimeout(
      () => {
        visibleSinceRef.current = null;
        setVisible(false);
      },
      Math.max(0, minimum - elapsed),
    );
    return () => window.clearTimeout(timer);
  }, [delay, minimum, pending, visible]);

  return visible;
}
