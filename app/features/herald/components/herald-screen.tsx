import {
  ArrowLeftIcon,
  HistoryIcon,
  LayoutGridIcon,
  LockKeyholeIcon,
  NewspaperIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

import { Button } from "~/shared/ui/button";
import { ConfirmDialog } from "~/shared/components/confirm-dialog";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/shared/ui/tabs";
import { useHeraldDemo } from "../demo/use-herald-demo";
import { heraldCategories } from "../model/types";
import type {
  HeraldArticle,
  HeraldEdition,
  HeraldEditorTarget,
  HeraldItem,
  HeraldViewer,
} from "../model/types";
import { EditionShelf } from "./edition-shelf";
import { ArticleDialog, EditionDialog } from "./reader-dialogs";
import { ReaderLayout } from "./reader-layouts";
import { PollShelf } from "./poll-shelf";
import {
  ContentEditor,
  EditorialDesk,
  EditorAccessDialog,
  HistoryDialog,
  PasswordDialog,
} from "./editor-dialogs";

export function HeraldScreen({ viewer }: { viewer: HeraldViewer }) {
  const demo = useHeraldDemo(viewer);
  const [layout, setLayout] = useState<"classic" | "magazine">("classic");
  const [category, setCategory] = useState("All stories");
  const [article, setArticle] = useState<HeraldArticle | null>(null);
  const [edition, setEdition] = useState<HeraldEdition | null>(null);
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [closingPoll, setClosingPoll] = useState<string | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deskOpen, setDeskOpen] = useState(false);
  const [editor, setEditor] = useState<HeraldEditorTarget | null>(null);
  const [deleting, setDeleting] = useState<HeraldItem | null>(null);
  const [notice, setNotice] = useState("");
  const canViewHistory = demo.unlocked || viewer.role === "admin";
  const articles = demo.articles.filter(
    (item) => category === "All stories" || item.category === category,
  );
  return (
    <div className="herald">
      <div className="herald-utility">
        <Link to="/menu" className="herald-back">
          <ArrowLeftIcon aria-hidden className="size-4" />
          학교 기능
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          {viewer.role === "admin" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPasswordOpen(true)}
            >
              Manage password
            </Button>
          ) : null}
          {canViewHistory ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setHistoryOpen(true)}
            >
              <HistoryIcon data-icon="inline-start" />
              Activity history
            </Button>
          ) : null}
          {viewer.type === "student" ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (demo.unlocked) {
                  demo.lock();
                  setHistoryOpen(false);
                } else setAccessOpen(true);
              }}
            >
              <LockKeyholeIcon data-icon="inline-start" />
              {demo.unlocked ? "Lock editor" : "Editor access"}
            </Button>
          ) : null}
        </div>
      </div>
      <header className="herald-masthead">
        <h1>
          <img
            className="herald-banner"
            src="/herald/banner.png"
            alt="Minjok Herald"
            width={1640}
            height={840}
            fetchPriority="high"
          />
        </h1>
        <div className="herald-motto">
          <p>
            Student-led press based in KMLA (Korean Minjok Leadership Academy).
          </p>
          <p>Written/Edited by students, for students</p>
        </div>
      </header>
      <Tabs
        value={layout}
        onValueChange={(value) =>
          setLayout(value === "magazine" ? "magazine" : "classic")
        }
      >
        <div className="herald-toolbar">
          <div className="herald-section-select">
            <label htmlFor="herald-section">IN THIS ISSUE</label>
            <NativeSelect
              id="herald-section"
              aria-label="Story section"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {["All stories", ...heraldCategories].map((value) => (
                <NativeSelectOption key={value}>{value}</NativeSelectOption>
              ))}
            </NativeSelect>
          </div>
          <TabsList aria-label="Reading layout">
            <TabsTrigger value="classic">
              <NewspaperIcon aria-hidden />
              Classic
            </TabsTrigger>
            <TabsTrigger value="magazine">
              <LayoutGridIcon aria-hidden />
              Magazine
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="herald-preview-note">
          <span>DESIGN PREVIEW</span>
          <p>Sample stories and images · Edits and votes reset on reload.</p>
        </div>
        {demo.unlocked ? (
          <div className="herald-editor-toolbar">
            <span>
              Editing as <strong>{viewer.name}</strong>
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => setEditor({ kind: "Story" })}>
                <PlusIcon data-icon="inline-start" />
                New story
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditor({ kind: "Edition" })}
              >
                Add edition
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditor({ kind: "Poll" })}
              >
                Create poll
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDeskOpen(true)}
              >
                Editorial desk
              </Button>
            </div>
          </div>
        ) : null}
        {notice ? (
          <p role="status" className="mb-4 text-sm text-muted-foreground">
            {notice}
          </p>
        ) : null}
        {(["classic", "magazine"] as const).map((view) => (
          <TabsContent key={view} value={view}>
            <ReaderLayout
              layout={view}
              articles={articles}
              onRead={setArticle}
              sidebar={
                <>
                  <EditionShelf editions={demo.editions} onRead={setEdition} />
                  <PollShelf
                    polls={demo.polls}
                    onVote={demo.vote}
                    onClose={demo.unlocked ? setClosingPoll : undefined}
                  />
                </>
              }
            />
          </TabsContent>
        ))}
      </Tabs>
      <footer className="herald-footer">
        <strong>Minjok Herald.</strong>
        <Button
          role="link"
          nativeButton={false}
          variant="ghost"
          render={<Link to="/menu" />}
        >
          Back to menu
          <ArrowLeftIcon data-icon="inline-end" />
        </Button>
      </footer>
      {passwordOpen && viewer.role === "admin" ? (
        <PasswordDialog
          onChange={(password) => {
            demo.changePassword(password);
            setDeskOpen(false);
            setEditor(null);
            setNotice("Demo password changed. Editor access is locked.");
          }}
          onClose={() => setPasswordOpen(false)}
        />
      ) : null}
      {closingPoll && demo.unlocked ? (
        <ConfirmDialog
          title="Close this poll?"
          description="Voting will stop and results will become visible to all readers."
          confirmLabel="Close voting"
          onCancel={() => setClosingPoll(null)}
          onConfirm={() => {
            demo.closePoll(closingPoll);
            setClosingPoll(null);
          }}
        />
      ) : null}
      {article ? (
        <ArticleDialog article={article} onClose={() => setArticle(null)} />
      ) : null}
      {edition ? (
        <EditionDialog edition={edition} onClose={() => setEdition(null)} />
      ) : null}
      {accessOpen ? (
        <EditorAccessDialog
          onUnlock={demo.unlock}
          onClose={() => setAccessOpen(false)}
        />
      ) : null}
      {editor && demo.unlocked ? (
        <ContentEditor
          target={editor}
          fileUrl={demo.fileUrl}
          onSave={(value) => {
            demo.save(value);
            setCategory("All stories");
            setNotice(value.kind + " saved in this preview.");
          }}
          onClose={() => setEditor(null)}
        />
      ) : null}
      {deskOpen && demo.unlocked ? (
        <EditorialDesk
          articles={demo.articles}
          editions={demo.editions}
          polls={demo.polls}
          onEdit={(target) => {
            setDeskOpen(false);
            setEditor(target);
          }}
          onDelete={(target) => {
            setDeskOpen(false);
            setDeleting(target);
          }}
          onClose={() => setDeskOpen(false)}
        />
      ) : null}
      {deleting && demo.unlocked ? (
        <ConfirmDialog
          title="Delete this item?"
          description={
            <>
              “{deleting.item.title}” will be removed. History will keep the
              action and your name, with no content backup or restore.
            </>
          }
          confirmLabel="Delete item"
          destructive
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            demo.remove(deleting);
            setDeleting(null);
            setNotice("Item deleted. The action remains in activity history.");
          }}
        />
      ) : null}
      {historyOpen && canViewHistory ? (
        <HistoryDialog
          events={demo.events}
          onClose={() => setHistoryOpen(false)}
        />
      ) : null}
    </div>
  );
}
