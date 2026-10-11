import { Suspense, use, type ReactNode } from "react";

/**
 * loader가 기다리지 않고 promise째 넘긴 값을 그 자리에서만 기다린다. 화면의 나머지는 먼저 그려진다.
 * 값이 이미 있으면 Suspense 없이 그대로 그린다 — 같은 loader가 경우에 따라 기다리기도 하기 때문이다.
 * promise는 loader 데이터처럼 렌더 사이에 같은 객체여야 한다. 렌더마다 새로 만들면 끝나지 않는다.
 */
export function Deferred<T>({
  value,
  fallback,
  children,
}: {
  value: T | Promise<T>;
  fallback: ReactNode;
  children: (value: T) => ReactNode;
}) {
  if (!(value instanceof Promise)) return children(value);
  return (
    <Suspense fallback={fallback}>
      <Resolved promise={value}>{children}</Resolved>
    </Suspense>
  );
}

function Resolved<T>({
  promise,
  children,
}: {
  promise: Promise<T>;
  children: (value: T) => ReactNode;
}) {
  return children(use(promise));
}
