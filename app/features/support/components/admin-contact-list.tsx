import { Suspense, useState } from "react";
import { Await } from "react-router";

import {
  adminContactHref,
  type AdminContact,
} from "~/features/support/model/admin-contacts";

/**
 * 막힌 사람만 찾아 누르도록 눈에 띄지 않게 둔다. 문구는 화면의 상황을 묻는 질문이라, 해당하지
 * 않는 사람은 궁금해서 누를 이유가 없다. 연락처가 하나도 없으면 아무것도 그리지 않는다.
 */
export function AdminContactList({
  contacts,
  prompt,
}: {
  contacts: AdminContact[];
  prompt: string;
}) {
  const [open, setOpen] = useState(false);
  if (!contacts.length) return null;
  return (
    <div className="w-full text-center text-xs text-muted-foreground">
      {open ? (
        <ul aria-label="관리자 연락처" className="flex flex-col gap-1">
          {contacts.map((contact, index) => (
            // 같은 주소를 두 번 등록하는 것을 막지 않으므로 순서가 유일한 키다.
            <li key={index} className="break-all">
              {contact.label}{" "}
              <a
                href={adminContactHref(contact)}
                className="underline underline-offset-4 hover:text-foreground"
                {...(contact.kind === "link"
                  ? { target: "_blank", rel: "noreferrer" }
                  : {})}
              >
                {contact.value}
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <button
          type="button"
          aria-expanded={false}
          className="underline-offset-4 hover:text-foreground hover:underline"
          onClick={() => setOpen(true)}
        >
          {prompt}
        </button>
      )}
    </div>
  );
}

/**
 * 인증 화면은 연락처를 기다리지 않고 먼저 그린다. loader가 넘긴 promise가 실패하면 영역만 빠진다.
 */
export function DeferredAdminContactList({
  contacts,
  prompt,
}: {
  contacts: Promise<AdminContact[]>;
  prompt: string;
}) {
  return (
    <Suspense fallback={null}>
      <Await resolve={contacts} errorElement={null}>
        {(resolved) => <AdminContactList contacts={resolved} prompt={prompt} />}
      </Await>
    </Suspense>
  );
}
