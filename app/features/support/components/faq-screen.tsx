import { ChevronDownIcon, LifeBuoyIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/shared/ui/empty";
import type { FaqSection, SupportContact } from "../model/types";

interface FaqScreenProps {
  sections: FaqSection[];
  contacts: SupportContact[];
  /** 링크로 보낼 곳은 없고 글로만 안내할 문의 방법. */
  note?: ReactNode;
}

/**
 * 도움말 화면.
 *
 * 아코디언을 상태로 만들지 않고 `<details>`에 맡긴다. 열림 상태가 화면 안에만 사는 값이라
 * React state로 올릴 이유가 없고, 그 대가로 브라우저의 키보드 조작과 페이지 내 찾기(닫힌
 * 답변까지 펼쳐서 찾아 준다)를 공짜로 얻는다.
 */
export function FaqScreen({ sections, contacts, note }: FaqScreenProps) {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 p-4 md:p-0">
      <h1 className="hidden text-2xl font-semibold md:block">도움말</h1>

      {sections.length === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LifeBuoyIcon aria-hidden />
            </EmptyMedia>
            <EmptyTitle>아직 등록된 도움말이 없어요</EmptyTitle>
            <EmptyDescription>
              자주 묻는 질문이 정리되면 여기에 올라옵니다.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        sections.map((section) => (
          <section
            key={section.id}
            aria-labelledby={`faq-${section.id}`}
            className="flex flex-col gap-1.5"
          >
            <h2
              id={`faq-${section.id}`}
              className="px-1 text-xs font-semibold tracking-wide text-muted-foreground"
            >
              {section.title}
            </h2>

            <div className="divide-y overflow-hidden rounded-xl border bg-card">
              {section.items.map((item) => (
                <details key={item.question} className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3.5 text-sm font-medium transition-colors hover:bg-muted/60 [&::-webkit-details-marker]:hidden">
                    <span className="min-w-0 flex-1">{item.question}</span>

                    <ChevronDownIcon
                      className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
                      aria-hidden
                    />
                  </summary>

                  {/* 링크 스타일을 여기서 한 번에 준다. 콘텐츠 파일이 className을 들고
                      다니지 않아야 글만 고치는 편집이 쉬워진다. */}
                  <div className="px-4 pb-4 text-sm leading-relaxed text-muted-foreground [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-2 [&_b]:font-medium [&_b]:text-foreground">
                    {item.answer}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))
      )}

      {note || contacts.length > 0 ? (
        <section className="flex flex-col gap-1.5">
          <h2 className="px-1 text-xs font-semibold tracking-wide text-muted-foreground">
            문의
          </h2>

          <div className="divide-y overflow-hidden rounded-xl border bg-card">
            {note ? (
              <p className="px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                {note}
              </p>
            ) : null}

            {contacts.map((contact) => (
              <ContactRow key={contact.to} contact={contact} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

const ROW_CLASS =
  "flex flex-col gap-0.5 px-4 py-3 transition-colors hover:bg-muted/60";

function ContactRow({ contact }: { contact: SupportContact }) {
  const body = (
    <>
      <span className="text-sm font-medium">{contact.label}</span>
      {contact.description ? (
        <span className="text-xs text-muted-foreground">
          {contact.description}
        </span>
      ) : null}
    </>
  );

  // 앱 안 경로는 라우터로, 웹 주소는 새 탭으로, `mailto:`·`tel:`은 그냥 넘긴다 — 메일
  // 앱을 새 탭에서 열면 빈 탭이 하나 남는다.
  if (contact.to.startsWith("/")) {
    return (
      <Link to={contact.to} className={ROW_CLASS}>
        {body}
      </Link>
    );
  }

  const external = /^https?:/.test(contact.to);

  return (
    <a
      href={contact.to}
      className={ROW_CLASS}
      {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
    >
      {body}
    </a>
  );
}
