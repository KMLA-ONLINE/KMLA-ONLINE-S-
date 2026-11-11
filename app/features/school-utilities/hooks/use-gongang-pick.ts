import { useState } from "react";

interface Draft {
  detail: string;
  recurring: boolean;
}

const emptyDraft: Draft = { detail: "", recurring: false };

/**
 * The one gongang cell whose booking dialog is open, plus what was typed per
 * cell. Closing a dialog keeps its draft so a stray tap outside loses nothing;
 * only a successful save clears it.
 */
export function useGongangPick(date: string) {
  const [picked, setPicked] = useState<{ date: string; key: string } | null>(
    null,
  );
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});

  const key = picked?.date === date ? picked.key : null;
  const draftKey = key ? `${date} ${key}` : "";
  const draft = drafts[draftKey] ?? emptyDraft;

  function update(next: Partial<Draft>) {
    setDrafts((current) => ({
      ...current,
      [draftKey]: { ...(current[draftKey] ?? emptyDraft), ...next },
    }));
  }

  return {
    key,
    detail: draft.detail,
    recurring: draft.recurring,
    open: (next: string) => setPicked({ date, key: next }),
    close: () => setPicked(null),
    setDetail: (detail: string) => update({ detail }),
    setRecurring: (recurring: boolean) => update({ recurring }),
    /** After a successful save: close and forget the draft. */
    finish: () => {
      setPicked(null);
      setDrafts((current) => {
        const next = { ...current };
        delete next[draftKey];
        return next;
      });
    },
  };
}
