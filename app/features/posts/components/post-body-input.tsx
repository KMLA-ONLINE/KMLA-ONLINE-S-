import { lazy, Suspense, useEffect, useState } from "react";

import { Textarea } from "~/shared/ui/textarea";

const DesktopMarkdownEditor = lazy(
  () => import("~/features/posts/components/desktop-markdown-editor"),
);

export function PostBodyInput({ initialValue }: { initialValue: string }) {
  const [desktop, setDesktop] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 768px)");
    const update = () => setDesktop(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  if (!desktop)
    return (
      <Textarea
        name="body"
        defaultValue={initialValue}
        maxLength={20_000}
        required
        aria-label="Markdown 본문"
        placeholder="본문을 입력하세요"
        className="post-typography min-h-72 resize-y whitespace-pre-wrap md:hidden"
      />
    );

  return (
    <Suspense
      fallback={<div className="min-h-72 rounded-md border" aria-busy="true" />}
    >
      <DesktopMarkdownEditor initialValue={initialValue} />
    </Suspense>
  );
}
