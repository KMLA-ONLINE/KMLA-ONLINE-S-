import { useT } from "~/shared/i18n";

/**
 * 인증 화면 아래의 이용약관·개인정보 처리방침 링크.
 *
 * 새 탭으로 연다. 가입 화면의 이메일·비밀번호는 폼 안에만 있어서, 같은 탭에서 떠나면
 * 입력한 값이 사라진다.
 */
export function LegalLinks() {
  const t = useT();

  return (
    <p className="flex justify-center gap-3 text-xs">
      <a
        href="/terms-of-service"
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        {t("이용약관")}
      </a>
      <span aria-hidden>·</span>
      <a
        href="/privacy-policy"
        target="_blank"
        rel="noreferrer"
        className="hover:underline"
      >
        {t("개인정보 처리방침")}
      </a>
    </p>
  );
}
