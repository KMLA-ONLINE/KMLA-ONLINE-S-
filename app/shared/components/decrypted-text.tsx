import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { cn } from "~/shared/lib/utils";

/**
 * 영숫자를 뒤섞을 때 쓰는 글자 풀. 구두점을 뺀 것은 취향이 아니라 폭 때문이다 — 자간이 넓은
 * 작은 배지에서 `%`나 `@`가 스쳐 지나가면 그 칸만 눈에 띄게 굵어 보인다.
 */
const DEFAULT_CHARACTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeToReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function prefersReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

function getServerReducedMotion() {
  return false;
}

interface DecryptedTextProps {
  text: string;
  /** 한 프레임 간격(ms). */
  speed?: number;
  /** `sequential`이 꺼져 있을 때 전체를 몇 번 뒤섞고 확정할지. */
  maxIterations?: number;
  /** 한 글자씩 차례로 확정한다. 끄면 전부 뒤섞다가 한 번에 확정한다. */
  sequential?: boolean;
  /** `sequential`일 때 확정이 번져 나가는 방향. */
  revealDirection?: "start" | "end" | "center";
  characters?: string;
  /** 확정된 글자 한 칸에 붙는다. */
  className?: string;
  /** 아직 뒤섞이는 글자 한 칸에 붙는다. */
  encryptedClassName?: string;
  /** 바깥 `<span>`에 붙는다. 타이포그래피는 여기에 준다. */
  parentClassName?: string;
}

/** 확정할 인덱스 순서. */
function revealOrder(
  length: number,
  direction: NonNullable<DecryptedTextProps["revealDirection"]>,
): number[] {
  const indices = Array.from({ length }, (_, index) => index);
  if (direction === "start") return indices;
  if (direction === "end") return indices.reverse();

  // 가운데에서 좌우로 번갈아 번져 나간다.
  const middle = length / 2;
  return indices.sort(
    (a, b) => Math.abs(a - middle + 0.5) - Math.abs(b - middle + 0.5),
  );
}

/**
 * 글자 하나를 무엇으로 바꿀지 고른다. 한글은 한글로, 영숫자는 `pool`로 바꾸고, 공백과 문장부호는
 * 건드리지 않는다.
 *
 * 종류를 갈라 두는 이유는 폭이다. 전각인 한글 자리에 반각 라틴이 들어가면 프레임마다 줄 너비가
 * 출렁이고, 문장부호 자리에 글자가 들어가도 마찬가지다. 한글 음절끼리는 폭이 같으므로 서로
 * 바꾸는 한 줄 길이가 변하지 않는다.
 */
function scrambleChar(char: string, pool: readonly string[]): string {
  const code = char.codePointAt(0) ?? 0;
  if (code >= HANGUL_FIRST && code <= HANGUL_LAST) {
    return String.fromCodePoint(
      HANGUL_FIRST +
        Math.floor(Math.random() * (HANGUL_LAST - HANGUL_FIRST + 1)),
    );
  }
  if (!/[A-Za-z0-9]/.test(char)) return char;
  return pool[Math.floor(Math.random() * pool.length)];
}

function scramble(
  chars: readonly string[],
  revealed: ReadonlySet<number>,
  pool: readonly string[],
): string[] {
  return chars.map((char, index) =>
    revealed.has(index) ? char : scrambleChar(char, pool),
  );
}

/** 진행 중인 한 프레임. `null`이면 정지 상태 — 시작 전이거나 이미 다 확정됐다. */
interface Frame {
  display: readonly string[];
  revealed: ReadonlySet<number>;
}

/**
 * 글자를 무작위로 뒤섞다가 원래 텍스트로 확정하는 "해독" 연출. 마운트될 때 한 번 돈다.
 *
 * 보이는 쪽과 읽히는 쪽을 갈라 둔다. 낭독 대상은 언제나 완성된 `text`다 — 뒤섞이는 중간 상태가
 * 읽히면 그냥 잡음이고, 하필 에러 화면에서 상태 코드가 난수로 들리는 일은 없어야 한다.
 *
 * `prefers-reduced-motion`이면 애니메이션 없이 완성된 텍스트로 남는다. 이 판정을 이펙트가 아니라
 * `useSyncExternalStore`로 읽는 이유는 두 가지다. 렌더 중에 `window`를 건드리지 않아야 하고 —
 * 이 컴포넌트는 `root.tsx`의 `ErrorBoundary` 임포트 그래프에 있다 — 첫 프레임을 이펙트에서
 * `setState`로 만들면 렌더가 한 번 더 도는 연쇄가 생기기 때문이다. 첫 프레임은 `useState`
 * 초기화 함수가 만들고, 그 뒤로는 인터벌만 상태를 건드린다.
 *
 * 한글과 문장부호는 폭이 보존되지만(`scrambleChar` 참고) 라틴 문자는 글자마다 폭이 달라 그대로
 * 두면 줄 너비가 출렁인다. 영숫자를 뒤섞는 자리에서는 `className`과 `encryptedClassName` 양쪽에
 * 고정 폭 칸을 줘야 한다.
 */
export function DecryptedText(props: DecryptedTextProps) {
  // `text`가 바뀌면 진행 중이던 해독을 이어받지 않고 처음부터 다시 시작한다. 리셋을 이펙트의
  // `setState`로 흉내 내는 대신 React가 원래 제공하는 수단인 `key`에 맡긴다.
  return <DecryptRun key={props.text} {...props} />;
}

function DecryptRun({
  text,
  speed = 50,
  maxIterations = 10,
  sequential = false,
  revealDirection = "start",
  characters = DEFAULT_CHARACTERS,
  className,
  encryptedClassName,
  parentClassName,
}: DecryptedTextProps) {
  // 서로게이트 페어가 반 토막 나지 않도록 코드 유닛이 아니라 글자 단위로 다룬다.
  const chars = useMemo(() => Array.from(text), [text]);
  const pool = useMemo(() => Array.from(characters), [characters]);
  const order = useMemo(
    () => revealOrder(chars.length, revealDirection),
    [chars.length, revealDirection],
  );

  const reducedMotion = useSyncExternalStore(
    subscribeToReducedMotion,
    prefersReducedMotion,
    getServerReducedMotion,
  );

  const [frame, setFrame] = useState<Frame | null>(() => ({
    display: scramble(chars, new Set(), pool),
    revealed: new Set(),
  }));

  useEffect(() => {
    if (reducedMotion || chars.length === 0) return;

    let revealed: ReadonlySet<number> = new Set();
    let iterations = 0;

    const timer = setInterval(() => {
      if (sequential) {
        revealed = new Set(revealed).add(order[revealed.size]);
        if (revealed.size >= chars.length) {
          clearInterval(timer);
          setFrame(null);
          return;
        }
        setFrame({ display: scramble(chars, revealed, pool), revealed });
        return;
      }

      iterations += 1;
      if (iterations >= maxIterations) {
        clearInterval(timer);
        setFrame(null);
        return;
      }
      setFrame({ display: scramble(chars, revealed, pool), revealed });
    }, speed);

    return () => clearInterval(timer);
  }, [chars, pool, order, sequential, maxIterations, speed, reducedMotion]);

  const shown = reducedMotion || frame === null ? chars : frame.display;

  return (
    <span className={cn("inline-block whitespace-pre-wrap", parentClassName)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden="true">
        {shown.map((char, index) => (
          <span
            key={index}
            className={
              !reducedMotion && frame?.revealed.has(index) === false
                ? encryptedClassName
                : className
            }
          >
            {char}
          </span>
        ))}
      </span>
    </span>
  );
}
