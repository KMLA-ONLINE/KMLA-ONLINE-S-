import { PlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import {
  normalizePollDraft,
  POLL_OPTION_MAX,
  POLL_OPTIONS_MAX,
  POLL_QUESTION_MAX,
  validatePollDraft,
  type PollDraft,
  type PollDraftErrors,
} from "~/features/messaging/model/poll";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import { Field, FieldError, FieldLabel } from "~/shared/ui/field";
import { Spinner } from "~/shared/ui/spinner";
import { Switch } from "~/shared/ui/switch";
import { TextField } from "~/shared/ui/text-field";

/** 그룹 대화의 투표 만들기(기능 명세 §13.30). 질문, 선택지 2~10개, 복수 선택 허용을 받는다. */
export function CreatePollDialog({
  open,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 성공하면 true. 실패하면 입력을 그대로 두고 다시 시도하게 한다. */
  onSubmit: (draft: PollDraft) => Promise<boolean>;
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [multiple, setMultiple] = useState(false);
  const [errors, setErrors] = useState<PollDraftErrors | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setQuestion("");
    setOptions(["", ""]);
    setMultiple(false);
    setErrors(null);
  };

  const submit = async () => {
    if (saving) return;
    const draft = { question, options, multiple };
    const found = validatePollDraft(draft);
    setErrors(found);
    if (found) return;
    setSaving(true);
    try {
      const created = await onSubmit(normalizePollDraft(draft));
      if (created) {
        reset();
        onOpenChange(false);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-5"
        >
          <DialogHeader>
            <DialogTitle>투표 만들기</DialogTitle>
            <DialogDescription>
              멤버 모두가 고를 수 있고, 누가 골랐는지도 모두에게 보입니다.
            </DialogDescription>
          </DialogHeader>

          <Field data-invalid={Boolean(errors?.question)}>
            <FieldLabel htmlFor="poll-question">질문</FieldLabel>
            <TextField
              id="poll-question"
              value={question}
              maxLength={POLL_QUESTION_MAX}
              placeholder="무엇을 물어볼까요?"
              aria-invalid={Boolean(errors?.question)}
              onChange={(event) => setQuestion(event.currentTarget.value)}
            />
            <FieldError>{errors?.question}</FieldError>
          </Field>

          <Field data-invalid={Boolean(errors?.options)}>
            <FieldLabel>선택지</FieldLabel>
            <div className="flex flex-col gap-2">
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <TextField
                    aria-label={`선택지 ${index + 1}`}
                    value={option}
                    maxLength={POLL_OPTION_MAX}
                    placeholder={`선택지 ${index + 1}`}
                    onChange={(event) => {
                      const value = event.currentTarget.value;
                      setOptions((current) =>
                        current.map((item, at) =>
                          at === index ? value : item,
                        ),
                      );
                    }}
                  />
                  {options.length > 2 ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="shrink-0 rounded-full"
                      aria-label={`선택지 ${index + 1} 삭제`}
                      onClick={() =>
                        setOptions((current) =>
                          current.filter((_, at) => at !== index),
                        )
                      }
                    >
                      <XIcon aria-hidden />
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
            {options.length < POLL_OPTIONS_MAX ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit"
                onClick={() => setOptions((current) => [...current, ""])}
              >
                <PlusIcon aria-hidden data-icon="inline-start" />
                선택지 추가
              </Button>
            ) : null}
            <FieldError>{errors?.options}</FieldError>
          </Field>

          <Field orientation="horizontal">
            <FieldLabel htmlFor="poll-multiple">복수 선택 허용</FieldLabel>
            <Switch
              id="poll-multiple"
              checked={multiple}
              onCheckedChange={setMultiple}
            />
          </Field>

          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              disabled={saving}
              onClick={() => onOpenChange(false)}
            >
              취소
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner data-icon="inline-start" /> : null}
              투표 만들기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
