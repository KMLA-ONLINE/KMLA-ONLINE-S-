import { PencilIcon } from "lucide-react";
import { useState } from "react";

import type { MessageParticipant } from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Spinner } from "~/shared/ui/spinner";
import { TextField } from "~/shared/ui/text-field";

export function ConversationNicknamesDialog({
  participants,
  viewerId,
  onCancel,
  onSubmit,
}: {
  participants: MessageParticipant[];
  viewerId: string;
  onCancel: () => void;
  onSubmit: (profileId: string, nickname: string) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const selected = participants.find(({ id }) => id === selectedId);
  const originalName = selected?.profileName ?? selected?.name;

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      if (await onSubmit(selected.id, nickname.trim())) onCancel();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{selected ? "별명 변경" : "별명"}</DialogTitle>
          <DialogDescription>
            {selected ? originalName : "이 채팅의 모든 멤버에게 보입니다."}
          </DialogDescription>
        </DialogHeader>
        {selected ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <TextField
              aria-label="별명"
              placeholder={originalName}
              value={nickname}
              maxLength={50}
              enterKeyHint="done"
              disabled={saving}
              onChange={(event) => setNickname(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || event.nativeEvent.isComposing)
                  return;
                event.preventDefault();
                void save();
              }}
            />
            <Button
              type="button"
              variant="ghost"
              className="mt-1 -ml-3"
              disabled={saving || !nickname}
              onClick={() => setNickname("")}
            >
              원래 이름으로
            </Button>
            <DialogFooter className="mt-4">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setSelectedId(null)}
              >
                뒤로
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner data-icon="inline-start" /> : null}
                저장
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="-mx-2 flex flex-col gap-1">
            {participants
              .filter(({ active }) => active)
              .map((participant) => (
                <button
                  key={participant.id}
                  type="button"
                  aria-label={`${participant.profileName ?? participant.name} 별명 변경`}
                  className="flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => {
                    setSelectedId(participant.id);
                    setNickname(participant.nickname ?? "");
                  }}
                >
                  <UserAvatar
                    src={participant.avatarUrl}
                    name={participant.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">
                      {participant.name}
                      {participant.id === viewerId ? " (나)" : ""}
                    </span>
                    {participant.nickname && participant.profileName ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {participant.profileName}
                      </span>
                    ) : null}
                  </span>
                  <PencilIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground"
                  />
                </button>
              ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
