import { ArrowUpRightIcon, BookOpenIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import type { HeraldEdition } from "../model/types";

export function EditionCover({ edition }: { edition: HeraldEdition }) {
  return edition.cover ? (
    <img
      src={edition.cover}
      alt={edition.issue + " edition: " + edition.title}
      width={1089}
      height={1540}
      loading="lazy"
      className="herald-edition-cover"
    />
  ) : (
    <div
      className="herald-sample-cover"
      aria-label={edition.issue + " edition sample cover"}
    >
      <span>
        MINJOK
        <br />
        HERALD
      </span>
      <span className="herald-sample-issue">{edition.issue}</span>
      <strong>{edition.title}</strong>
      <small>ILLUSTRATIVE COVER</small>
    </div>
  );
}

export function EditionShelf({
  editions,
  onRead,
}: {
  editions: HeraldEdition[];
  onRead: (edition: HeraldEdition) => void;
}) {
  const [latest, ...past] = editions;
  const [archiveOpen, setArchiveOpen] = useState(false);
  const readEdition = (edition: HeraldEdition) => {
    setArchiveOpen(false);
    onRead(edition);
  };
  const archiveRow = (edition: HeraldEdition) => (
    <button
      key={edition.id}
      onClick={() => readEdition(edition)}
      className="herald-archive-row"
      aria-label={"Read " + edition.issue + " edition"}
    >
      <EditionCover edition={edition} />
      <span>
        <strong>{edition.issue} edition</strong>
        <small>{edition.title}</small>
        <small>{edition.season}</small>
        {edition.sample ? <small>Sample cover</small> : null}
      </span>
      <ArrowUpRightIcon className="size-4" aria-hidden />
    </button>
  );
  return (
    <section
      className="herald-editions"
      aria-labelledby="herald-editions-heading"
    >
      <div className="herald-section-heading">
        <h2 id="herald-editions-heading">The print edition</h2>
        <BookOpenIcon aria-hidden className="size-4" />
      </div>
      {latest ? (
        <>
          <button
            className="herald-edition-display"
            onClick={() => onRead(latest)}
            aria-label={"Read " + latest.issue + " edition"}
          >
            <EditionCover edition={latest} />
          </button>
          <div className="herald-edition-caption">
            <span className="herald-kicker">
              ISSUE {latest.issue.toUpperCase()}
            </span>
            <h3>{latest.title}</h3>
            <p>
              {latest.pages ? latest.pages + " pages · " : ""}
              {latest.season}
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onRead(latest)}
          >
            Explore this edition
            <ArrowUpRightIcon data-icon="inline-end" />
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          The next edition starts here.
        </p>
      )}
      {past.length > 0 ? (
        <div className="herald-past-editions">
          <h3>FROM THE ARCHIVE</h3>
          {past.slice(0, 4).map(archiveRow)}
        </div>
      ) : null}
      {editions.length > 0 ? (
        <Button
          variant="outline"
          className="mt-4 w-full"
          onClick={() => setArchiveOpen(true)}
        >
          View all editions
        </Button>
      ) : null}
      {archiveOpen ? (
        <Dialog open onOpenChange={setArchiveOpen}>
          <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Edition archive</DialogTitle>
              <DialogDescription>
                Every available semester edition, newest first.
              </DialogDescription>
            </DialogHeader>
            <div className="herald-full-archive">
              {editions.map(archiveRow)}
            </div>
          </DialogContent>
        </Dialog>
      ) : null}
    </section>
  );
}
