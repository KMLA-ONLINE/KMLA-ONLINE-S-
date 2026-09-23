import { Avatar, AvatarFallback, AvatarImage } from "~/shared/ui/avatar";

/**
 * 이미지가 없거나 로드에 실패했을 때 쓰는 기본 실루엣. `public/`에서 그대로 서빙되므로
 * 번들에 들어가지 않고, 여러 아바타가 한 화면에 있어도 요청은 한 번뿐이다.
 */
const FALLBACK_SRC = "/avatar.svg";

interface UserAvatarProps {
  /**
   * 프로필 이미지 URL. Supabase Storage의 public URL(`getPublicUrl()`)이나 signed URL을
   * 그대로 넘기면 된다. `null`이거나 로드에 실패하면 기본 실루엣으로 떨어진다.
   *
   * 여기서 URL을 만들지는 않는다 — Supabase 호출은 `features/<feature>/data/**`의 몫이다.
   */
  src?: string | null;
  /** 사람 이름. 이미지의 대체 텍스트로만 쓴다. */
  name?: string | null;
  /** `sm` 24px · `default` 32px · `lg` 40px. */
  size?: "sm" | "default" | "lg";
  className?: string;
}

/**
 * **사람 전용** 아바타. 프로필 이미지 자리에는 항상 이걸 쓴다.
 *
 * 폴백이 이니셜이 아니라 실루엣인 게 핵심이다. 이 서비스는 실명을 쓰기 때문에 이니셜을 그리면
 * 사진을 올리지 않은 사람의 이름 첫 글자가 목록 전체에 노출된다.
 *
 * 그룹·동아리처럼 사람이 아닌 대상에는 쓰지 않는다. 그쪽은 `~/shared/ui/avatar`의 원자를
 * 직접 조합해서 각자의 폴백(로고, 이니셜)을 그린다.
 */
export function UserAvatar({
  src,
  name,
  size = "default",
  className,
}: UserAvatarProps) {
  const alt = name ? `${name} 프로필 사진` : "프로필 사진";

  return (
    <Avatar size={size} className={className}>
      {src ? <AvatarImage src={src} alt={alt} /> : null}

      {/* 실루엣의 어깨가 뷰박스 밑변까지 꽉 차서, 원 밖으로 삐져나오지 않게 `overflow-hidden`이
          필요하다. `AvatarFallback`은 이니셜을 담는 게 기본이라 clip을 걸어두지 않는다.

          `avatar.svg`는 검정 단색이라 다크 모드에서 배경에 묻힌다. `invert`로 흰 실루엣을
          만들고, 양쪽 모두 투명도를 낮춰 실제 사진 옆에서 튀지 않게 한다. */}
      <AvatarFallback className="overflow-hidden">
        <img
          src={FALLBACK_SRC}
          alt={alt}
          className="size-full object-cover opacity-40 dark:opacity-55 dark:invert"
        />
      </AvatarFallback>
    </Avatar>
  );
}
