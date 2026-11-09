import { PlayIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { MotionKind } from "~/shared/lib/media/motion-policy";

/** 화면에 닿기 조금 전부터 받아 둔다. 스크롤해 들어오는 순간 빈 칸이 보이지 않는다. */
const GIF_LOAD_MARGIN = "200px";

/**
 * 격자 칸의 동영상·GIF. 동영상은 첫 프레임과 재생 표시만 그리고 파일을 받지 않는다. GIF는 화면에 보일
 * 때만 소리 없이 반복 재생한다(기능 명세 §18.7). 자동 재생이 막히면 첫 프레임이 남고, 칸을 누르면
 * 뷰어에서 재생된다.
 */
export function MotionTile({
  kind,
  src,
  poster,
  alt,
}: {
  kind: MotionKind;
  src: string;
  poster: string | null | undefined;
  alt: string;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reducedMotion] = useState(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const plays = kind === "gif" && !reducedMotion;

  useEffect(() => {
    const element = container.current;
    if (!plays || !element || typeof IntersectionObserver === "undefined") {
      return;
    }
    const nearby = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setNear(true);
        nearby.disconnect();
      },
      { rootMargin: GIF_LOAD_MARGIN },
    );
    const onScreen = new IntersectionObserver(([entry]) =>
      setVisible(entry?.isIntersecting ?? false),
    );
    nearby.observe(element);
    onScreen.observe(element);
    return () => {
      nearby.disconnect();
      onScreen.disconnect();
    };
  }, [plays]);

  useEffect(() => {
    const element = video.current;
    if (!element) return;
    if (visible) void element.play().catch(() => undefined);
    else element.pause();
  }, [visible, near]);

  return (
    <span ref={container} className="relative block size-full">
      {poster ? (
        <img
          src={poster}
          alt={alt}
          crossOrigin="anonymous"
          loading="lazy"
          decoding="async"
          className="absolute inset-0 size-full object-cover"
        />
      ) : (
        <span className="absolute inset-0 bg-muted" />
      )}
      {plays && near ? (
        <video
          ref={video}
          src={src}
          crossOrigin="anonymous"
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden
          tabIndex={-1}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
      {kind === "video" ? (
        <span
          aria-hidden
          className="absolute top-1/2 left-1/2 flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-black/55 text-white"
        >
          <PlayIcon className="size-5 fill-current" />
        </span>
      ) : (
        <span
          aria-hidden
          className="absolute bottom-1.5 left-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] leading-none font-semibold text-white"
        >
          GIF
        </span>
      )}
    </span>
  );
}
