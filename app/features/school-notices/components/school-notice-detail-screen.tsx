import { ExternalLinkIcon, PaperclipIcon } from "lucide-react";

import type { SchoolNoticeDetail } from "~/features/school-notices/data/school-notices";
import {
  schoolAttachmentUrl,
  schoolNoticeUrl,
} from "~/features/school-notices/model/school-notice-link";

/**
 * 학교 공지 본문. 본문은 동기화 때 텍스트로 바꿔 저장한 것이라 HTML로 렌더링하지 않는다. 첨부는
 * 학교 다운로드 주소로 연결해, 학교 사이트에 로그인된 브라우저에서만 받아진다.
 */
export function SchoolNoticeDetailScreen({
  notice,
}: {
  notice: SchoolNoticeDetail;
}) {
  return (
    <article className="px-4 py-4">
      <header className="space-y-1 border-b pb-3">
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span className="tabular-nums">
            {notice.posted_on.replaceAll("-", "/")}
          </span>
          <span aria-hidden>|</span>
          <span>{notice.category}</span>
          <span aria-hidden>|</span>
          <span>{notice.author}</span>
        </p>
        <h2 className="text-lg font-semibold break-keep">{notice.title}</h2>
      </header>

      {notice.body ? (
        <p className="py-4 text-sm leading-relaxed break-words whitespace-pre-wrap">
          {notice.body}
        </p>
      ) : (
        <p className="py-4 text-sm text-muted-foreground">본문이 없습니다.</p>
      )}

      {notice.attachments.length > 0 ? (
        <section className="space-y-2 border-t pt-3">
          <h3 className="text-sm font-medium">첨부 파일</h3>
          <p className="text-xs text-muted-foreground">
            학교 사이트에 로그인되어 있어야 받을 수 있어요.
          </p>
          <ul className="space-y-1">
            {notice.attachments.map((file) => (
              <li key={file.attachment_id}>
                <a
                  href={schoolAttachmentUrl(file.attachment_id)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-start gap-2 rounded-md px-2 py-1.5 text-sm transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
                >
                  <PaperclipIcon
                    className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                  <span className="min-w-0 break-all">{file.name}</span>
                  <span className="sr-only">(새 탭)</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="border-t pt-3">
        <a
          href={schoolNoticeUrl(notice.post_id)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground underline-offset-4 hover:underline"
        >
          학교 사이트에서 보기
          <ExternalLinkIcon className="size-3.5" aria-hidden />
          <span className="sr-only">(새 탭)</span>
        </a>
      </div>
    </article>
  );
}
