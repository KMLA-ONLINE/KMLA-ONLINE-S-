import { ChartNoAxesColumnIncreasingIcon, CheckIcon } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "~/shared/ui/button";
import { Field, FieldLabel, FieldLegend, FieldSet } from "~/shared/ui/field";
import { RadioGroup, RadioGroupItem } from "~/shared/ui/radio-group";
import type { HeraldPoll } from "../model/types";
import { formatPollDeadline } from "../model/polls";

export function PollCard({
  poll,
  onVote,
  onClose,
}: {
  poll: HeraldPoll;
  onVote: (id: string, choice: string) => void;
  onClose?: (id: string) => void;
}) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const selected = draft ?? poll.choice ?? "";
  const showResults = poll.choice !== null || poll.closed;
  const total = poll.options.reduce((sum, option) => sum + option.votes, 0);
  return (
    <section className="herald-poll" aria-labelledby={id}>
      <div className="herald-section-heading">
        <h2>Have your say</h2>
        <ChartNoAxesColumnIncreasingIcon aria-hidden className="size-4" />
      </div>
      {poll.closesAt ? (
        <p className="mb-4 text-xs leading-relaxed text-muted-foreground">
          {poll.closed ? "Scheduled close: " : "Closes: "}
          <time dateTime={poll.closesAt}>
            {formatPollDeadline(poll.closesAt)}
          </time>
        </p>
      ) : null}
      <FieldSet>
        <FieldLegend id={id}>{poll.title}</FieldLegend>
        <RadioGroup
          aria-labelledby={id}
          value={selected}
          onValueChange={(value) => setDraft(String(value))}
          disabled={poll.closed}
        >
          {poll.options.map((option) => {
            const percent =
              total === 0 ? 0 : Math.round((option.votes / total) * 100);
            return (
              <div key={option.id} className="herald-poll-option">
                <Field orientation="horizontal">
                  <RadioGroupItem id={id + option.id} value={option.id} />
                  <FieldLabel htmlFor={id + option.id}>
                    {option.label}
                  </FieldLabel>
                  {poll.choice === option.id ? (
                    <CheckIcon
                      className="size-3 text-primary"
                      aria-label="Your vote"
                    />
                  ) : null}
                </Field>
                {showResults ? (
                  <div className="herald-poll-result">
                    <div>
                      <span style={{ width: percent + "%" }} />
                    </div>
                    <span>{percent}%</span>
                  </div>
                ) : null}
              </div>
            );
          })}
        </RadioGroup>
      </FieldSet>
      <div className="herald-poll-footer" aria-live="polite">
        {showResults ? (
          <p>{total} demo votes</p>
        ) : (
          <p>Vote to see the results.</p>
        )}
        {poll.closed ? (
          <p>Poll closed</p>
        ) : (
          <Button
            size="sm"
            disabled={!selected || selected === poll.choice}
            onClick={() => {
              onVote(poll.id, selected);
              setDraft(null);
            }}
          >
            {poll.choice ? "Change vote" : "Vote"}
          </Button>
        )}
      </div>
      <p className="herald-poll-note">
        One choice per reader. Change it until the poll closes.
      </p>
      {onClose && !poll.closed ? (
        <Button size="sm" variant="ghost" onClick={() => onClose(poll.id)}>
          Close poll
        </Button>
      ) : null}
    </section>
  );
}
