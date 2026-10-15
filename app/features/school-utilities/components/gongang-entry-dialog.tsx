import type { ReactNode } from "react";

import type { GongangBoardEntry } from "../model/gongang-entries";
import { gongangCellLabel } from "../model/gongang-slots";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "~/shared/ui/dialog";

/** Details of one occupied cell; each screen supplies who it is and what can be done. */
export function GongangEntryDialog({
  date,
  entry,
  description,
  children,
  actions,
  onClose,
}: {
  date: string;
  entry: GongangBoardEntry;
  description: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle>
          {gongangCellLabel(date, entry.slot, entry.location)}
        </DialogTitle>
        <DialogDescription>
          {description}
          {entry.recurring && " · 매주 반복"}
        </DialogDescription>
        {entry.detail && <p className="break-words">{entry.detail}</p>}
        {children}
        {actions && <DialogFooter>{actions}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
