import { useState } from "react";

import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { TextField } from "~/shared/ui/text-field";
import { Spinner } from "~/shared/ui/spinner";

/** 그룹 이름 상한(기능 명세 §13.15). 서버 `rename_conversation`이 같은 상한을 강제한다. */
const GROUP_NAME_MAX_LENGTH = 50;

/** 그룹 대화 이름 바꾸기. 바꾼 이름은 모든 멤버에게 보이고 대화 안에 시스템 메시지로 남는다. */
export function RenameConversationDialog({
  currentName,
  onCancel,
  onSubmit,
}: {
  currentName: string;
  onCancel: () => void;
  /** 성공하면 true. 실패하면 입력을 그대로 두고 다시 시도하게 한다. */
  onSubmit: (name: string) => Promise<boolean>;
}) {
  const [name, setName] = useState(currentName);
  const [saving, setSaving] = useState(false);
  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= GROUP_NAME_MAX_LENGTH;

  async function save() {
    if (!valid || saving) return;
    if (trimmed === currentName) {
      onCancel();
      return;
    }
    setSaving(true);
    const saved = await onSubmit(trimmed);
    setSaving(false);
    if (saved) onCancel();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>그룹 이름 변경</DialogTitle>
          <DialogDescription>
            바꾼 이름은 모든 멤버에게 보입니다.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <TextField
            value={name}
            maxLength={GROUP_NAME_MAX_LENGTH}
            enterKeyHint="done"
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              // 한 줄 입력이라 Enter가 제출이다. 조합 중의 Enter는 IME 확정이다.
              if (event.key !== "Enter" || event.nativeEvent.isComposing)
                return;
              event.preventDefault();
              void save();
            }}
            aria-label="그룹 이름"
          />
          <DialogFooter className="mt-4">
            <Button type="button" variant="outline" onClick={onCancel}>
              취소
            </Button>
            <Button type="submit" disabled={!valid || saving}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              저장
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
