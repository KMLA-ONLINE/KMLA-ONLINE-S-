import type { ReactNode } from "react";

import { defineAppChrome, PageHeader } from "~/features/app-shell";
import { useT } from "~/shared/i18n";

export const handle = defineAppChrome({
  header: "sticky",
  bottomNav: "sticky",
});

export default function LicensesPage() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("오픈소스 라이선스")} back="/settings" />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4 md:p-0">
        <h1 className="hidden text-2xl font-semibold md:block">
          {t("오픈소스 라이선스")}
        </h1>
        <div className="rounded-xl border bg-card p-4 text-sm leading-relaxed text-muted-foreground">
          <p>
            {withLinks(
              t(
                "이모지 그래픽은 {twemoji} (© Twitter, Inc 및 기여자들)를 사용하며, {license} 라이선스를 따릅니다.",
              ),
              {
                twemoji: (
                  <LicenseLink href="https://github.com/jdecked/twemoji">
                    Twemoji
                  </LicenseLink>
                ),
                license: (
                  <LicenseLink href="https://creativecommons.org/licenses/by/4.0/">
                    CC-BY 4.0
                  </LicenseLink>
                ),
              },
            )}
          </p>
          <p className="mt-3">
            {withLinks(
              t(
                "HEIC/HEIF 이미지 변환에는 {heicTo} 및 libheif를 사용하며 LGPL-3.0 라이선스를 따릅니다.",
              ),
              {
                heicTo: (
                  <LicenseLink href="https://github.com/hoppergee/heic-to">
                    heic-to
                  </LicenseLink>
                ),
              },
            )}
          </p>
        </div>
      </div>
    </>
  );
}

function LicenseLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="text-foreground underline underline-offset-2"
    >
      {children}
    </a>
  );
}

/** 번역된 문장 속 `{name}` 자리에 링크를 끼운다. 영어가 어순을 바꿔도 링크가 제자리를 찾는다. */
function withLinks(
  template: string,
  links: Record<string, ReactNode>,
): ReactNode[] {
  return template.split(/(\{\w+\})/).map((part, index) => {
    const name = /^\{(\w+)\}$/.exec(part)?.[1];
    return name && name in links ? (
      <span key={index}>{links[name]}</span>
    ) : (
      part
    );
  });
}
