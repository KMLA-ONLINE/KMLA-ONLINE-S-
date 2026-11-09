import {
  MaximizeIcon,
  MinimizeIcon,
  PauseIcon,
  PlayIcon,
  RotateCcwIcon,
  Volume1Icon,
  Volume2Icon,
  VolumeXIcon,
} from "lucide-react";

import { clamp } from "~/shared/lib/image-viewer-geometry";
import { formatPlaybackTime } from "~/shared/lib/media/video-shortcuts";
import { cn } from "~/shared/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "~/shared/ui/dropdown-menu";

const BUTTON_CLASS =
  "flex size-10 shrink-0 items-center justify-center rounded-full hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:outline-none";

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2];

const SOUND_STORAGE_KEY = "kmla-online:video-sound:v1";

/** 다음 영상에도 이어 쓰는 소리 설정. 저장이 막힌 브라우저에서는 기본값으로 돌아갈 뿐이다. */
export function readVideoSound(): { volume: number; muted: boolean } | null {
  try {
    const stored = JSON.parse(
      localStorage.getItem(SOUND_STORAGE_KEY) ?? "null",
    ) as { volume?: unknown; muted?: unknown } | null;
    if (typeof stored?.volume !== "number") return null;
    return {
      volume: clamp(stored.volume, 0, 1),
      muted: stored.muted === true,
    };
  } catch {
    return null;
  }
}

export function saveVideoSound(volume: number, muted: boolean) {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify({ volume, muted }));
  } catch {
    // 다음 영상에서 기본값으로 시작한다.
  }
}

/**
 * 막대 모양은 직접 그리고 위에 투명한 range를 덮는다. 끌기와 키보드, 스크린리더는 브라우저 기본을 쓰고,
 * 받아 둔 구간까지 그리려면 native 트랙으로는 브라우저마다 다른 CSS가 필요하다.
 */
function PlayerSlider({
  label,
  max,
  value,
  buffered,
  volume,
  className,
  onChange,
}: {
  label: string;
  max: number;
  value: number;
  buffered?: number;
  /** 소리 막대의 화살표는 뷰어의 재생 단축키 대신 막대 자신을 움직인다. */
  volume?: boolean;
  className?: string;
  onChange: (next: number) => void;
}) {
  const percent = (part: number) =>
    max > 0 ? `${Math.min(100, (part / max) * 100)}%` : "0%";
  return (
    <div
      className={cn("group/slider relative flex h-5 items-center", className)}
    >
      <input
        type="range"
        min={0}
        max={max}
        step="any"
        value={value}
        aria-label={label}
        data-video-volume={volume ? true : undefined}
        className="peer absolute inset-0 z-10 m-0 size-full cursor-pointer opacity-0"
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <div className="relative h-1 w-full overflow-hidden rounded-full bg-white/30 transition-[height] group-hover/slider:h-1.5 peer-focus-visible:ring-2 peer-focus-visible:ring-white/70">
        {buffered === undefined ? null : (
          <div
            className="absolute inset-y-0 left-0 bg-white/40"
            style={{ width: percent(buffered) }}
          />
        )}
        <div
          className="absolute inset-y-0 left-0 bg-primary"
          style={{ width: percent(value) }}
        />
      </div>
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white shadow"
        style={{ left: percent(value) }}
      />
    </div>
  );
}

export interface VideoPlaybackState {
  playing: boolean;
  ended: boolean;
  currentTime: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  rate: number;
}

/** 동영상 뷰어의 재생 막대. 유튜브처럼 위에 위치 막대, 아래에 버튼 줄을 둔다. */
export function VideoPlayerControls({
  state,
  hidden,
  fullscreen,
  canFullscreen,
  left,
  width,
  bottom,
  onTogglePlayback,
  onToggleFullscreen,
  onSeek,
  onSound,
  onRate,
}: {
  state: VideoPlaybackState;
  hidden: boolean;
  fullscreen: boolean;
  canFullscreen: boolean;
  left: number;
  width: number;
  bottom: string;
  onTogglePlayback: () => void;
  onToggleFullscreen: () => void;
  onSeek: (time: number) => void;
  onSound: (volume: number, muted: boolean) => void;
  onRate: (rate: number) => void;
}) {
  const { playing, ended, currentTime, duration, buffered, volume, muted } =
    state;
  const silent = muted || volume === 0;
  const VolumeIcon = silent
    ? VolumeXIcon
    : volume < 0.5
      ? Volume1Icon
      : Volume2Icon;

  return (
    <div
      inert={hidden}
      // 눌러도 뷰어 손짓으로 번지지 않는다.
      className={cn(
        "absolute z-10 bg-linear-to-t from-black/80 to-transparent px-3 pt-8 text-white transition-opacity duration-200",
        hidden && "opacity-0",
      )}
      style={{ left, width, bottom }}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
    >
      <PlayerSlider
        label="재생 위치"
        max={Number.isFinite(duration) ? duration : 0}
        value={currentTime}
        buffered={buffered}
        onChange={onSeek}
      />
      <div className="flex items-center gap-1 pb-1">
        <button
          type="button"
          aria-label={ended ? "다시 재생" : playing ? "일시 정지" : "재생"}
          className={BUTTON_CLASS}
          onClick={onTogglePlayback}
        >
          {ended ? (
            <RotateCcwIcon aria-hidden className="size-5" />
          ) : playing ? (
            <PauseIcon aria-hidden className="size-5 fill-current" />
          ) : (
            <PlayIcon aria-hidden className="size-5 fill-current" />
          )}
        </button>
        <button
          type="button"
          aria-label={silent ? "소리 켜기" : "소리 끄기"}
          className={BUTTON_CLASS}
          onClick={() =>
            // 막대를 0까지 내려 소리가 없었다면 켤 때 들리는 크기로 돌린다.
            onSound(volume === 0 ? 0.5 : volume, !silent)
          }
        >
          <VolumeIcon aria-hidden className="size-5" />
        </button>
        {/* 터치 기기의 소리는 기기 버튼이 정한다. iPhone은 페이지에서 바꿀 수도 없다. */}
        <PlayerSlider
          label="소리 크기"
          volume
          max={1}
          value={silent ? 0 : volume}
          className="mr-2 hidden w-20 shrink-0 pointer-fine:flex"
          onChange={(next) => onSound(next, next === 0)}
        />
        <span className="ml-1 shrink-0 text-xs tabular-nums">
          {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
        </span>
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button
                type="button"
                aria-label={`재생 속도 ${state.rate}배`}
                className={cn(
                  BUTTON_CLASS,
                  "w-auto min-w-10 px-2 text-xs font-medium tabular-nums",
                )}
              />
            }
          >
            {state.rate}x
          </DropdownMenuTrigger>
          {/* 뷰어가 z-60이라 메뉴는 그보다 위에 떠야 한다. */}
          <DropdownMenuContent
            align="end"
            side="top"
            positionerClassName="z-70"
            className="min-w-24 bg-black text-white ring-white/15"
          >
            {PLAYBACK_RATES.map((rate) => (
              <DropdownMenuItem
                key={rate}
                className={cn(
                  "py-2 tabular-nums focus:bg-white/15 focus:text-white",
                  rate === state.rate && "font-semibold",
                )}
                onClick={() => onRate(rate)}
              >
                {rate === 1 ? "보통" : `${rate}배`}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        {canFullscreen ? (
          <button
            type="button"
            aria-label={fullscreen ? "전체화면 종료" : "전체화면"}
            className={BUTTON_CLASS}
            onClick={onToggleFullscreen}
          >
            {fullscreen ? (
              <MinimizeIcon aria-hidden className="size-5" />
            ) : (
              <MaximizeIcon aria-hidden className="size-5" />
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
