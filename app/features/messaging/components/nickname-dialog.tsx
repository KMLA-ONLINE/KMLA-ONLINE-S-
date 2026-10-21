import { ChevronLeftIcon } from "lucide-react";
import { useState } from "react";

import {
  NICKNAME_MAX_LENGTH,
  nicknameProblem,
} from "~/features/messaging/model/nickname";
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

/**
 * 그룹 대화의 별명. 지금 멤버 목록에서 한 사람을 고르면 그 사람의 별명을 정하거나 지운다. 내 행이 맨 위다. 멤버와 별명은
 * 다른 멤버가 바꿀 수 있어 대화 목록의 최신 참여자를 받는다.
 */
export function NicknameDialog({
  members,
  viewerId,
  onClose,
  onSubmit,
}: {
  /** 지금 멤버. 멤버 목록 순서다. */
  members: MessageParticipant[];
  viewerId: string;
  onClose: () => void;
  /** 빈 값이면 지운다. 성공하면 true. 실패하면 입력을 그대로 두고 다시 시도하게 한다. */
  onSubmit: (profileId: string, nickname: string) => Promise<boolean>;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const ordered = [
    ...members.filter(({ id }) => id === viewerId),
    ...members.filter(({ id }) => id !== viewerId),
  ];
  const editing = ordered.find(({ id }) => id === editingId);
  // 고치는 사이 그 사람이 나갔으면 목록으로 돌아가고 고르던 사람도 잊는다. 다시 초대되어도 편집으로 튀어 들어가지 않는다.
  if (editingId !== null && !editing) setEditingId(null);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-sm">
        {editing ? (
          <NicknameForm
            // 고치는 사이 다른 멤버가 같은 사람의 별명을 바꾸면 입력을 새 별명으로 다시 시작한다. 낡은 입력으로 저장해
            // 그 변경을 덮어쓰지 않게 한다.
            key={`${editing.id}:${editing.nickname ?? ""}`}
            member={editing}
            isViewer={editing.id === viewerId}
            onBack={() => setEditingId(null)}
            onSubmit={async (nickname) => {
              const saved = await onSubmit(editing.id, nickname);
              if (saved) setEditingId(null);
              return saved;
            }}
          />
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>별명</DialogTitle>
            </DialogHeader>
            <ul className="-mx-2 flex max-h-[60dvh] flex-col gap-1 overflow-y-auto">
              {ordered.map((member) => {
                const profileName = member.profileName ?? member.name;
                const isViewer = member.id === viewerId;
                return (
                  <li key={member.id}>
                    <button
                      type="button"
                      onClick={() => setEditingId(member.id)}
                      className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted/70 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
                    >
                      <UserAvatar
                        src={member.avatarUrl}
                        name={profileName}
                        size="lg"
                      />
                      <MemberNames member={member} isViewer={isViewer} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 별명이 있으면 별명 아래에 프로필 이름을 작게, 없으면 프로필 이름만 보인다. 대화 정보의 멤버 목록도 쓴다. */
export function MemberNames({
  member,
  isViewer,
}: {
  member: MessageParticipant;
  isViewer: boolean;
}) {
  const profileName = member.profileName ?? member.name;
  const primary = member.nickname ?? profileName;
  return (
    <span className="flex min-w-0 flex-1 flex-col">
      <span className="truncate text-sm font-medium">
        {isViewer ? `${primary} (나)` : primary}
      </span>
      {member.nickname ? (
        <span className="truncate text-xs text-muted-foreground">
          {profileName}
        </span>
      ) : null}
    </span>
  );
}

function NicknameForm({
  member,
  isViewer,
  onBack,
  onSubmit,
}: {
  member: MessageParticipant;
  isViewer: boolean;
  onBack: () => void;
  onSubmit: (nickname: string) => Promise<boolean>;
}) {
  const current = member.nickname ?? "";
  const profileName = member.profileName ?? member.name;
  const [nickname, setNickname] = useState(current);
  const [saving, setSaving] = useState(false);
  const trimmed = nickname.trim();
  const problem = nicknameProblem(trimmed);

  async function save(next: string) {
    if (saving) return;
    // 그대로면 서버도 아무것도 남기지 않으므로 보내지 않는다.
    if (next === current) {
      onBack();
      return;
    }
    setSaving(true);
    await onSubmit(next);
    setSaving(false);
  }

  return (
    <>
      <DialogHeader>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="-ml-2 rounded-full"
            aria-label="별명 목록으로 돌아가기"
            onClick={onBack}
          >
            <ChevronLeftIcon aria-hidden />
          </Button>
          <DialogTitle className="min-w-0 truncate">
            {isViewer ? "내 별명" : `${profileName}님의 별명`}
          </DialogTitle>
        </div>
        <DialogDescription>
          비워 두고 저장하면 별명을 지웁니다.
        </DialogDescription>
      </DialogHeader>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!problem) void save(trimmed);
        }}
      >
        <TextField
          value={nickname}
          placeholder={profileName}
          enterKeyHint="done"
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? "nickname-error" : undefined}
          onChange={(event) => setNickname(event.currentTarget.value)}
          onKeyDown={(event) => {
            // 한 줄 입력이라 Enter가 제출이다. 조합 중의 Enter는 IME 확정이다.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            if (!problem) void save(trimmed);
          }}
          aria-label="별명"
        />
        {problem ? (
          <p id="nickname-error" className="mt-2 text-xs text-destructive">
            {problem === "too_long"
              ? `별명은 ${NICKNAME_MAX_LENGTH}자 이하로 입력하세요.`
              : "보이지 않는 글자는 별명에 쓸 수 없습니다."}
          </p>
        ) : null}
        <DialogFooter className="mt-4">
          {current ? (
            <Button
              type="button"
              variant="outline"
              className="sm:mr-auto"
              disabled={saving}
              onClick={() => void save("")}
            >
              별명 지우기
            </Button>
          ) : null}
          <Button type="submit" disabled={Boolean(problem) || saving}>
            {saving ? <Spinner data-icon="inline-start" /> : null}
            저장
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
