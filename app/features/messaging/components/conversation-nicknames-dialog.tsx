import { PencilIcon, XIcon } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";

import type { MessageParticipant } from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
import type { KeyboardViewport } from "~/shared/hooks/use-keyboard-viewport";
import { cn } from "~/shared/lib/utils";
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
  keyboardViewport,
  onCancel,
  onSubmit,
}: {
  participants: MessageParticipant[];
  viewerId: string;
  keyboardViewport?: KeyboardViewport;
  onCancel: () => void;
  onSubmit: (profileId: string, nickname: string) => Promise<boolean>;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nickname, setNickname] = useState("");
  const [saving, setSaving] = useState(false);
  const active = useRef(true);
  const closing = useRef(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  function close() {
    if (!active.current || closing.current) return;
    closing.current = true;
    onCancel();
  }
  const selected = participants.find(({ id }) => id === selectedId);
  const originalName = selected?.profileName ?? selected?.name;

  async function save() {
    if (!selected || saving) return;
    setSaving(true);
    try {
      if (await onSubmit(selected.id, nickname.trim())) close();
    } finally {
      if (active.current) setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && close()}>
      <DialogContent
        showCloseButton={false}
        className={cn(
          "top-0 left-0 flex h-dvh max-h-dvh max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0 pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] ring-0 sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[min(40rem,90dvh)] sm:max-w-sm sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pt-0 sm:pb-0 sm:ring-1",
          keyboardViewport?.keyboardOpen &&
            "max-sm:top-(--nickname-viewport-top) max-sm:h-(--nickname-viewport-height) max-sm:pt-0 max-sm:pb-0",
        )}
        style={
          keyboardViewport?.keyboardOpen
            ? ({
                "--nickname-viewport-top": `${keyboardViewport.offsetTop}px`,
                "--nickname-viewport-height": `${keyboardViewport.height}px`,
              } as CSSProperties)
            : undefined
        }
      >
        <DialogHeader className="relative shrink-0 gap-1 border-b px-5 py-4 pr-16">
          <DialogTitle className="text-base leading-6">
            {selected ? "별명 변경" : "별명"}
          </DialogTitle>
          {selected ? (
            <DialogDescription>{originalName}</DialogDescription>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="닫기"
            className="absolute top-3 right-3 size-11 rounded-full"
            onClick={close}
          >
            <XIcon aria-hidden />
          </Button>
        </DialogHeader>
        {selected ? (
          <form
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-5 py-5"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="mb-5 flex justify-center">
              <UserAvatar
                src={selected.avatarUrl}
                name={selected.name}
                className="size-16"
              />
            </div>
            <TextField
              aria-label="별명"
              name="nickname"
              className="text-base"
              placeholder="별명 입력…"
              value={nickname}
              maxLength={50}
              enterKeyHint="done"
              disabled={saving}
              onChange={(event) => setNickname(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                if (
                  event.nativeEvent.isComposing ||
                  event.nativeEvent.keyCode === 229
                )
                  return;
                event.preventDefault();
                void save();
              }}
            />
            <Button
              type="button"
              variant="ghost"
              className="mt-2 -ml-3 self-start"
              disabled={saving || !nickname}
              onClick={() => setNickname("")}
            >
              원래 이름으로
            </Button>
            <DialogFooter className="mt-auto flex-row justify-end pt-8 sm:pt-4">
              <Button
                type="button"
                variant="outline"
                disabled={saving}
                onClick={() => setSelectedId(null)}
              >
                취소
              </Button>
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner data-icon="inline-start" /> : null}
                저장
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain p-3">
            {participants
              .filter(({ active }) => active)
              .map((participant) => (
                <button
                  key={participant.id}
                  type="button"
                  aria-label={`${participant.profileName ?? participant.name} 별명 변경`}
                  className="flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-3 text-left hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring active:bg-muted"
                  onClick={() => {
                    setSelectedId(participant.id);
                    setNickname(participant.nickname ?? "");
                  }}
                >
                  <UserAvatar
                    src={participant.avatarUrl}
                    name={participant.profileName ?? participant.name}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {participant.nickname ??
                        participant.profileName ??
                        participant.name}
                      {participant.id === viewerId ? " (나)" : ""}
                    </span>
                    {participant.nickname &&
                    participant.nickname !==
                      (participant.profileName ?? participant.name) ? (
                      <span className="block truncate text-xs text-muted-foreground">
                        {participant.profileName ?? participant.name}
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
