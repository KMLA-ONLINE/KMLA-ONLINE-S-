import { ArrowUpRightIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import type { HeraldPoll } from "../model/types";
import { PollCard } from "./poll-card";

export function PollShelf({
  polls,
  onVote,
  onClose,
}: {
  polls: HeraldPoll[];
  onVote: (id: string, choice: string) => void;
  onClose?: (id: string) => void;
}) {
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const current = polls.filter((poll) => !poll.closed);
  const past = polls.filter((poll) => poll.closed);
  const selected = polls.find((poll) => poll.id === selectedId);
  const row = (poll: HeraldPoll) => (
    <button
      className="herald-poll-row"
      key={poll.id}
      aria-label={"View poll: " + poll.title}
      onClick={() => {
        setArchiveOpen(false);
        setSelectedId(poll.id);
      }}
    >
      <span>
        <strong>{poll.title}</strong>
        <small>
          {poll.closed ? "Closed · View results" : "Open · Have your say"}
        </small>
      </span>
      <ArrowUpRightIcon aria-hidden className="size-4 shrink-0" />
    </button>
  );
  return (
    <section aria-label="Herald polls" className="herald-poll-shelf">
      {current.slice(0, 2).map((poll) => (
        <PollCard key={poll.id} poll={poll} onVote={onVote} onClose={onClose} />
      ))}
      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No open polls right now.
        </p>
      ) : null}
      {past.length ? (
        <div>
          <div className="herald-section-heading">
            <h2>Past polls</h2>
          </div>
          {past.slice(0, 4).map(row)}
        </div>
      ) : null}
      {polls.length ? (
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setArchiveOpen(true)}
        >
          View all polls
        </Button>
      ) : null}
      {archiveOpen ? (
        <Dialog open onOpenChange={setArchiveOpen}>
          <DialogContent className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-xl">
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle>Poll archive</DialogTitle>
              <DialogDescription>
                Vote in an open poll or explore past results.
              </DialogDescription>
            </DialogHeader>
            <div className="min-h-0 overflow-y-auto">
              {current.length ? (
                <section aria-label="Current polls">
                  <h3 className="herald-kicker">Current polls</h3>
                  {current.map(row)}
                </section>
              ) : null}
              {past.length ? (
                <section aria-label="Past polls" className="mt-6">
                  <h3 className="herald-kicker">Past polls</h3>
                  {past.map(row)}
                </section>
              ) : null}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
      {selected ? (
        <Dialog open onOpenChange={(open) => !open && setSelectedId(null)}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
            <DialogHeader className="pr-8">
              <DialogTitle>{selected.title}</DialogTitle>
              <DialogDescription>
                {selected.closed
                  ? "This poll is closed. Its results remain available here."
                  : "One choice per reader. You can change your vote until this poll closes."}
              </DialogDescription>
            </DialogHeader>
            <PollCard
              key={selected.id}
              poll={selected}
              onVote={onVote}
              onClose={onClose}
            />
            <Button
              variant="ghost"
              onClick={() => {
                setSelectedId(null);
                setArchiveOpen(true);
              }}
            >
              Back to all polls
            </Button>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
