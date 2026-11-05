import { ArrowUpRightIcon, DownloadIcon } from "lucide-react";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import type { HeraldArticle, HeraldEdition } from "../model/types";
import { EditionCover } from "./edition-shelf";

export function ArticleDialog({
  article,
  onClose,
}: {
  article: HeraldArticle;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <span className="herald-kicker">
            {article.category} · Minjok Herald
          </span>
          <DialogTitle>{article.title}</DialogTitle>
          <DialogDescription>{article.deck}</DialogDescription>
        </DialogHeader>
        <figure className="herald-reader-photo">
          <img
            src={article.image}
            alt={article.title}
            width={1000}
            height={700}
          />
          <figcaption>{article.credit}</figcaption>
        </figure>
        <div className="herald-article-body">
          {article.body.split("\n\n").map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          {article.date} · Design preview
        </p>
      </DialogContent>
    </Dialog>
  );
}

export function EditionDialog({
  edition,
  onClose,
}: {
  edition: HeraldEdition;
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className={
          edition.pdf
            ? "flex h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-none flex-col gap-3 overflow-hidden p-4 sm:max-w-none sm:p-5"
            : "max-h-[90dvh] overflow-y-auto sm:max-w-3xl"
        }
      >
        <DialogHeader className="shrink-0 pr-9">
          <DialogTitle>
            {edition.issue} edition · {edition.title}
          </DialogTitle>
          <DialogDescription>
            {edition.sample
              ? "An illustrative archive cover. Add a PDF through the editor to try the edition reader."
              : "Read the original edition, or open and download the PDF. On phones, opening it in a new tab may work best."}
          </DialogDescription>
        </DialogHeader>
        {edition.pdf ? (
          <>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button
                role="link"
                nativeButton={false}
                variant="outline"
                render={
                  <a
                    aria-label="Open PDF in new tab"
                    href={edition.pdf}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                Open PDF in new tab
                <ArrowUpRightIcon data-icon="inline-end" />
              </Button>
              <Button
                role="link"
                nativeButton={false}
                variant="outline"
                render={
                  <a
                    aria-label="Download PDF"
                    href={edition.pdf}
                    download={edition.issue + "-edition.pdf"}
                  />
                }
              >
                Download PDF
                <DownloadIcon data-icon="inline-end" />
              </Button>
            </div>
            <iframe
              className="herald-pdf-reader"
              title={edition.issue + " edition PDF"}
              src={edition.pdf + "#toolbar=1"}
            />
          </>
        ) : (
          <div className="mx-auto w-52">
            <EditionCover edition={edition} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
