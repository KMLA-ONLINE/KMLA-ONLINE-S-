import type { ReactNode } from "react";

import { Input } from "~/shared/ui/input";
import { TextField } from "~/shared/ui/text-field";

function TestCase({ children, title }: { children: ReactNode; title: string }) {
  return (
    <div className="flex flex-col gap-2">
      <code aria-hidden="true" className="text-xs text-muted-foreground">
        {title}
      </code>
      {children}
    </div>
  );
}

export default function Theme() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col gap-4 p-6">
      <section className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold">Working variants</h1>
        <TestCase title="대부분 input">
          <Input placeholder="현재 문제 상황" />
        </TestCase>
        <TestCase title="type=text, name=email, autocomplete=none">
          <input
            aria-label="test input"
            autoComplete="none"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5"
            name="email"
            placeholder="입력"
            type="text"
          />
        </TestCase>
        <TestCase title="hidden text/password decoys, then name=real-username">
          <div>
            <input style={{ display: "none" }} type="text" />
            <input style={{ display: "none" }} type="password" />
            <input
              aria-label="test input"
              className="h-9 w-full rounded-md border border-input bg-transparent px-2.5"
              name="real-username"
              placeholder="입력"
              type="text"
            />
          </div>
        </TestCase>
        <TestCase title="native input readOnly, remove onFocus">
          <input
            aria-label="test input"
            className="h-9 w-full rounded-md border border-input bg-transparent px-2.5"
            onFocus={(event) => event.currentTarget.removeAttribute("readonly")}
            placeholder="입력"
            readOnly
            type="text"
          />
        </TestCase>
        <TestCase title="type=search">
          <Input aria-label="test input" placeholder="입력" type="search" />
        </TestCase>
        <TestCase title="type=search, cancel button hidden">
          <Input
            aria-label="test input"
            className="[&::-webkit-search-cancel-button]:appearance-none"
            placeholder="입력"
            type="search"
          />
        </TestCase>
        <TestCase title="TextField">
          <div className="flex flex-col gap-2">
            <TextField aria-label="test textarea" placeholder="입력" />
            <Input
              aria-label="next test input"
              placeholder="다음 포커스 대상"
              type="search"
            />
          </div>
        </TestCase>
      </section>
    </main>
  );
}
