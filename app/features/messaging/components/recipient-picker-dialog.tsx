import { useQuery } from "@tanstack/react-query";
import { CheckIcon, SearchIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { messagingKeys } from "~/features/messaging/data/cache";
import { searchMessageRecipients } from "~/features/messaging/data/queries";
import type { MessageRecipient } from "~/features/messaging/model/types";
import { UserAvatar } from "~/shared/components/user-avatar";
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
import { Input } from "~/shared/ui/input";
import { Spinner } from "~/shared/ui/spinner";
import { TextField } from "~/shared/ui/text-field";

/** 입력이 멈춘 뒤 이만큼 지나서 찾는다. 글자마다 요청하지 않는다. */
const SEARCH_DELAY_MS = 250;
/** 그룹 이름 상한(기능 명세 §13.15). 서버 `create_group_conversation`이 같은 상한을 강제한다. */
const GROUP_NAME_MAX_LENGTH = 50;

export interface RecipientSelection {
  recipients: MessageRecipient[];
  /** 두 명 이상을 골라 그룹을 만들 때의 이름. */
  groupName: string;
}

/**
 * 대화 상대 고르기. `create`는 한 명이면 1:1 대화, 두 명 이상이면 이름을 받아 그룹을 만든다. `invite`는
 * 지금 그룹에 사람을 더한다. `excludeIds`(이미 멤버인 사람)는 결과에서 고를 수 없다.
 */
export function RecipientPickerDialog({
  open,
  mode,
  excludeIds = [],
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  mode: "create" | "invite";
  excludeIds?: string[];
  onOpenChange: (open: boolean) => void;
  /** 실패하면 거부한다. 다이얼로그는 고른 사람을 그대로 두고 다시 시도하게 한다. */
  onSubmit: (selection: RecipientSelection) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [selected, setSelected] = useState<MessageRecipient[]>([]);
  const [groupName, setGroupName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(
      () => setSearchTerm(query.trim()),
      SEARCH_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [query]);

  const results = useQuery({
    queryKey: messagingKeys.recipients(searchTerm),
    queryFn: () => searchMessageRecipients(searchTerm),
    enabled: open && searchTerm !== "",
    staleTime: 30_000,
  });

  const makesGroup = mode === "create" && selected.length > 1;
  const trimmedName = groupName.trim();
  const canSubmit =
    selected.length > 0 &&
    !submitting &&
    (!makesGroup ||
      (trimmedName.length > 0 && trimmedName.length <= GROUP_NAME_MAX_LENGTH));

  function reset() {
    setQuery("");
    setSearchTerm("");
    setSelected([]);
    setGroupName("");
  }

  function toggle(recipient: MessageRecipient) {
    setSelected((current) =>
      current.some(({ id }) => id === recipient.id)
        ? current.filter(({ id }) => id !== recipient.id)
        : [...current, recipient],
    );
  }

  async function submit() {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit({ recipients: selected, groupName: trimmedName });
      reset();
    } catch {
      // 고른 사람을 그대로 두고 다시 시도하게 한다. 알림은 호출한 쪽이 띄운다.
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel =
    mode === "invite" ? "초대" : makesGroup ? "그룹 만들기" : "대화 시작";

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="flex max-h-[min(36rem,90dvh)] flex-col gap-3 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "invite" ? "멤버 초대" : "새 대화"}
          </DialogTitle>
          <DialogDescription>
            {mode === "invite"
              ? "그룹에 초대할 사람을 고르세요."
              : "한 명을 고르면 1:1 대화, 여러 명을 고르면 그룹 대화가 됩니다."}
          </DialogDescription>
        </DialogHeader>

        {selected.length > 0 ? (
          <ul aria-label="고른 사람" className="flex flex-wrap gap-1.5">
            {selected.map((recipient) => (
              <li key={recipient.id}>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-full pr-1.5"
                  aria-label={`${recipient.name} 빼기`}
                  onClick={() => toggle(recipient)}
                >
                  {recipient.name}
                  <XIcon aria-hidden />
                </Button>
              </li>
            ))}
          </ul>
        ) : null}

        {makesGroup ? (
          <TextField
            value={groupName}
            maxLength={GROUP_NAME_MAX_LENGTH}
            enterKeyHint="done"
            onChange={(event) => setGroupName(event.currentTarget.value)}
            placeholder="그룹 이름"
            aria-label="그룹 이름"
          />
        ) : null}

        <div className="relative">
          <SearchIcon
            aria-hidden
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="이름으로 찾기"
            aria-label="이름으로 찾기"
            className="rounded-full border-0 bg-muted pl-9"
          />
        </div>

        <div className="min-h-32 flex-1 overflow-y-auto overscroll-contain">
          {searchTerm === "" ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              이름을 입력하세요.
            </p>
          ) : results.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner />
            </div>
          ) : results.isError ? (
            <p
              role="alert"
              className="py-8 text-center text-sm text-destructive"
            >
              찾지 못했습니다. 잠시 후 다시 시도해 주세요.
            </p>
          ) : results.data.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              찾는 사람이 없습니다.
            </p>
          ) : (
            <ul aria-label="찾은 사람" className="flex flex-col gap-0.5">
              {results.data.map((recipient) => {
                const member = excludeIds.includes(recipient.id);
                const chosen = selected.some(({ id }) => id === recipient.id);
                return (
                  <li key={recipient.id}>
                    <button
                      type="button"
                      disabled={member}
                      aria-pressed={chosen}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50 disabled:hover:bg-transparent",
                        chosen && "bg-primary/10 hover:bg-primary/10",
                      )}
                      onClick={() => toggle(recipient)}
                    >
                      <UserAvatar
                        src={recipient.avatarUrl}
                        name={recipient.name}
                        size="lg"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {recipient.name}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {member ? "이미 멤버입니다" : recipient.description}
                        </span>
                      </span>
                      {chosen ? (
                        <CheckIcon
                          aria-hidden
                          className="size-4 shrink-0 text-primary"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <DialogFooter>
          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting ? <Spinner data-icon="inline-start" /> : null}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
