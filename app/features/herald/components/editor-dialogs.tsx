import {
  HistoryIcon,
  LockKeyholeIcon,
  PencilIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button } from "~/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/shared/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "~/shared/ui/field";
import { Input } from "~/shared/ui/input";
import { NativeSelect, NativeSelectOption } from "~/shared/ui/native-select";
import { TextField } from "~/shared/ui/text-field";
import { Textarea } from "~/shared/ui/textarea";
import { Switch } from "~/shared/ui/switch";
import { parsePollDeadline, pollDeadlineFields } from "../model/polls";
import { heraldCategories } from "../model/types";
import type {
  HeraldArticle,
  HeraldCategory,
  HeraldEdition,
  HeraldEditorTarget,
  HeraldEvent,
  HeraldItem,
  HeraldPoll,
} from "../model/types";

export function EditorAccessDialog({
  onUnlock,
  onClose,
}: {
  onUnlock: (password: string) => boolean;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <LockKeyholeIcon className="size-6 text-primary" aria-hidden />
          <DialogTitle>Editor access</DialogTitle>
          <DialogDescription>
            Any signed-in student with the Herald password can enter the
            newsroom. Your changes are attributed to your student account.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (onUnlock(password)) onClose();
            else setError("Incorrect demo password. Please try again.");
          }}
          className="flex flex-col gap-6"
        >
          <FieldGroup>
            <Field data-invalid={!!error}>
              <FieldLabel htmlFor="herald-password">Herald password</FieldLabel>
              <Input
                id="herald-password"
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  setError("");
                }}
                aria-invalid={!!error}
                aria-describedby="herald-password-help"
                autoComplete="off"
                required
              />
              <FieldDescription id="herald-password-help">
                Initial demo password: <code>herald-preview</code> (unless
                changed by an admin in this preview). This preview does not
                grant real publishing access.
              </FieldDescription>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="submit">Unlock editor</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function PasswordDialog({
  onChange,
  onClose,
}: {
  onChange: (password: string) => void;
  onClose: () => void;
}) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage password</DialogTitle>
          <DialogDescription>
            Admin-only demo. Changing the password locks the editor. Reloading
            restores the initial demo password.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            if (password !== confirmation) {
              setError("The passwords do not match.");
              return;
            }
            onChange(password);
            onClose();
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="herald-new-password">
                New demo password
              </FieldLabel>
              <Input
                id="herald-new-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <FieldDescription>
                At least 8 characters. Use a demo value, not a real password.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="herald-confirm-password">
                Confirm demo password
              </FieldLabel>
              <Input
                id="herald-confirm-password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
          </FieldGroup>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="submit">Change password</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function ContentEditor({
  target,
  onSave,
  onClose,
  fileUrl,
}: {
  target: HeraldEditorTarget;
  onSave: (value: HeraldItem) => void;
  onClose: () => void;
  fileUrl: (file: File) => string;
}) {
  const story = target.kind === "Story" ? target.item : undefined;
  const edition = target.kind === "Edition" ? target.item : undefined;
  const poll = target.kind === "Poll" ? target.item : undefined;
  const [automaticClose, setAutomaticClose] = useState(!!poll?.closesAt);
  const [deadline, setDeadline] = useState(() =>
    pollDeadlineFields(poll?.closesAt),
  );
  const [title, setTitle] = useState(target.item?.title ?? "");
  const [body, setBody] = useState(story?.body ?? "");
  const [deck, setDeck] = useState(story?.deck ?? "");
  const [category, setCategory] = useState<HeraldCategory>(
    story?.category ?? "Feature",
  );
  const [image, setImage] = useState(story?.image ?? "/herald/campus.jpg");
  const [issue, setIssue] = useState(edition?.issue ?? "");
  const [season, setSeason] = useState(edition?.season ?? "Semester edition");
  const [options, setOptions] = useState(
    poll?.options.map((option) => option.label).join("\n") ?? "",
  );
  const [file, setFile] = useState<File | null>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim() || (target.kind === "Story" && !body.trim())) {
      setError("Please fill in the title and required text.");
      return;
    }
    setPending(true);
    setError("");
    try {
      if (file && file.size > 30 * 1024 * 1024)
        throw new Error("Choose a file smaller than 30 MB for this preview.");
      if (target.kind === "Story") {
        if (
          file &&
          !["image/jpeg", "image/png", "image/webp"].includes(file.type)
        )
          throw new Error("Choose a JPEG, PNG, or WebP image.");
        onSave({
          kind: "Story",
          item: {
            id: story?.id ?? "",
            title: title.trim(),
            category,
            deck: deck.trim(),
            body: body.trim(),
            image: file ? fileUrl(file) : image,
            credit: file
              ? "Uploaded photograph · local preview only"
              : (story?.credit ?? "Placeholder photograph · design preview"),
            date:
              story?.date ??
              new Intl.DateTimeFormat("en", {
                dateStyle: "medium",
                timeZone: "Asia/Seoul",
              }).format(new Date()),
          },
        });
      } else if (target.kind === "Edition") {
        if (!issue.trim() || !season.trim())
          throw new Error("Enter an issue number and edition label.");
        if (!file && !edition?.pdf)
          throw new Error("Choose a PDF for this edition.");
        if (file) {
          const signature = new TextDecoder().decode(
            await file.slice(0, 5).arrayBuffer(),
          );
          if (signature !== "%PDF-") throw new Error("This file is not a PDF.");
        }
        onSave({
          kind: "Edition",
          item: {
            id: edition?.id ?? "",
            title: title.trim(),
            issue: issue.trim(),
            season: season.trim(),
            pdf: file ? fileUrl(file) : edition?.pdf,
            cover: edition?.cover,
            pages: file ? undefined : edition?.pages,
          },
        });
      } else {
        const closesAt = poll?.closed
          ? poll.closesAt
          : automaticClose
            ? parsePollDeadline(deadline)
            : undefined;
        if (!poll?.closed && closesAt && Date.parse(closesAt) <= Date.now())
          throw new Error("Choose a closing time in the future (KST).");
        const labels = options
          .split("\n")
          .map((label) => label.trim())
          .filter(Boolean);
        if (
          labels.length < 2 ||
          labels.length > 6 ||
          new Set(labels).size !== labels.length
        )
          throw new Error("Add 2–6 different choices, one per line.");
        onSave({
          kind: "Poll",
          item: poll
            ? { ...poll, title: title.trim(), closesAt }
            : {
                id: "",
                title: title.trim(),
                options: labels.map((label, index) => ({
                  id: String(index),
                  label,
                  votes: 0,
                })),
                choice: null,
                closed: false,
                closesAt,
              },
        });
      }
      onClose();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not prepare this file.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {target.item ? "Edit " : "New "}
            {target.kind.toLowerCase()}
          </DialogTitle>
          <DialogDescription>
            Design preview · Changes and selected files stay on this page until
            reload.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(event) => void submit(event)}
          onPaste={(event) => {
            if (target.kind !== "Story" || pending) return;
            const photo = Array.from(event.clipboardData.files).find((entry) =>
              entry.type.startsWith("image/"),
            );
            if (!photo) return;
            event.preventDefault();
            setFile(photo);
            setError("");
            if (photoInput.current) photoInput.current.value = "";
          }}
          className="flex flex-col gap-6"
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="herald-title">Title</FieldLabel>
              <TextField
                id="herald-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                required
                maxLength={160}
              />
            </Field>
            {target.kind === "Story" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="herald-category">Section</FieldLabel>
                  <NativeSelect
                    id="herald-category"
                    value={category}
                    onChange={(event) =>
                      setCategory(event.target.value as HeraldCategory)
                    }
                  >
                    {heraldCategories.map((value) => (
                      <NativeSelectOption key={value}>
                        {value}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="herald-summary">
                    Short introduction
                  </FieldLabel>
                  <Textarea
                    id="herald-summary"
                    value={deck}
                    onChange={(event) => setDeck(event.target.value)}
                    maxLength={400}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="herald-body">Story text</FieldLabel>
                  <Textarea
                    id="herald-body"
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    required
                    className="min-h-40"
                    maxLength={20000}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="herald-image">
                    Placeholder image
                  </FieldLabel>
                  <NativeSelect
                    id="herald-image"
                    value={image}
                    onChange={(event) => setImage(event.target.value)}
                  >
                    <NativeSelectOption value="/herald/campus.jpg">
                      Campus
                    </NativeSelectOption>
                    <NativeSelectOption value="/herald/library.jpg">
                      Library
                    </NativeSelectOption>
                    <NativeSelectOption value="/herald/the-scene.jpg">
                      The Scene
                    </NativeSelectOption>
                    <NativeSelectOption value="/herald/interview.jpg">
                      Interview
                    </NativeSelectOption>
                    <NativeSelectOption value="/herald/edition-70.jpg">
                      70th edition
                    </NativeSelectOption>
                    {image.startsWith("blob:") ? (
                      <NativeSelectOption value={image}>
                        Current uploaded image
                      </NativeSelectOption>
                    ) : null}
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="herald-file">
                    Or choose or paste a photo
                  </FieldLabel>
                  <Input
                    id="herald-file"
                    type="file"
                    ref={photoInput}
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                  <FieldDescription>
                    Copy an image, then paste in any field in this editor with
                    Ctrl+V (⌘V on Mac). One JPEG, PNG, or WebP photo per story,
                    up to 30 MB.
                  </FieldDescription>
                  {file ? (
                    <div className="flex items-center gap-2">
                      <p
                        role="status"
                        className="min-w-0 flex-1 text-sm break-words"
                      >
                        Selected photo: {file.name || "Clipboard image"}
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setFile(null);
                          setError("");
                          if (photoInput.current) photoInput.current.value = "";
                        }}
                      >
                        Remove photo
                      </Button>
                    </div>
                  ) : null}
                </Field>
              </>
            ) : null}
            {target.kind === "Edition" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="herald-issue">Issue number</FieldLabel>
                  <TextField
                    id="herald-issue"
                    value={issue}
                    onChange={(event) => setIssue(event.target.value)}
                    required
                    maxLength={20}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="herald-season">Edition label</FieldLabel>
                  <TextField
                    id="herald-season"
                    value={season}
                    onChange={(event) => setSeason(event.target.value)}
                    required
                    maxLength={100}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="herald-file">Edition PDF</FieldLabel>
                  <Input
                    id="herald-file"
                    type="file"
                    accept="application/pdf,.pdf"
                    required={!edition?.pdf}
                    onChange={(event) =>
                      setFile(event.target.files?.[0] ?? null)
                    }
                  />
                  <FieldDescription>
                    {edition?.pdf
                      ? "Leave empty to keep the current PDF. "
                      : ""}
                    Local preview only; maximum 30 MB.
                  </FieldDescription>
                </Field>
              </>
            ) : null}
            {target.kind === "Poll" ? (
              <>
                <Field>
                  <FieldLabel htmlFor="herald-options">
                    Choices, one per line
                  </FieldLabel>
                  <Textarea
                    id="herald-options"
                    value={options}
                    onChange={(event) => setOptions(event.target.value)}
                    required
                    readOnly={!!poll}
                    maxLength={600}
                  />
                  <FieldDescription>
                    {poll
                      ? "Existing choices stay fixed in this preview. Create a new poll for different choices."
                      : "Between two and six choices."}
                  </FieldDescription>
                </Field>
                <Field orientation="horizontal">
                  <div className="flex-1">
                    <FieldLabel htmlFor="herald-auto-close">
                      Close automatically
                    </FieldLabel>
                    <FieldDescription>
                      Choose a date and AM/PM time in Korea (KST).
                    </FieldDescription>
                  </div>
                  <Switch
                    id="herald-auto-close"
                    aria-label="Close automatically"
                    checked={automaticClose}
                    onCheckedChange={setAutomaticClose}
                    disabled={!!poll?.closed}
                  />
                </Field>
                {automaticClose ? (
                  <>
                    <Field>
                      <FieldLabel htmlFor="herald-close-date">
                        Closing date (KST)
                      </FieldLabel>
                      <Input
                        id="herald-close-date"
                        type="date"
                        value={deadline.date}
                        required
                        disabled={!!poll?.closed}
                        onChange={(event) =>
                          setDeadline({ ...deadline, date: event.target.value })
                        }
                      />
                    </Field>
                    <div className="grid grid-cols-3 gap-3">
                      <Field>
                        <FieldLabel htmlFor="herald-close-hour">
                          Hour
                        </FieldLabel>
                        <Input
                          id="herald-close-hour"
                          type="number"
                          min={1}
                          max={12}
                          step={1}
                          required
                          disabled={!!poll?.closed}
                          value={deadline.hour}
                          onChange={(event) =>
                            setDeadline({
                              ...deadline,
                              hour: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="herald-close-minute">
                          Minute
                        </FieldLabel>
                        <Input
                          id="herald-close-minute"
                          type="number"
                          min={0}
                          max={59}
                          step={1}
                          required
                          disabled={!!poll?.closed}
                          value={deadline.minute}
                          onChange={(event) =>
                            setDeadline({
                              ...deadline,
                              minute: event.target.value,
                            })
                          }
                        />
                      </Field>
                      <Field>
                        <FieldLabel htmlFor="herald-close-period">
                          AM/PM
                        </FieldLabel>
                        <NativeSelect
                          id="herald-close-period"
                          value={deadline.period}
                          disabled={!!poll?.closed}
                          onChange={(event) =>
                            setDeadline({
                              ...deadline,
                              period: event.target.value,
                            })
                          }
                        >
                          <NativeSelectOption value="AM">AM</NativeSelectOption>
                          <NativeSelectOption value="PM">PM</NativeSelectOption>
                        </NativeSelect>
                      </Field>
                    </div>
                  </>
                ) : null}
                {poll?.closed ? (
                  <p className="text-xs text-muted-foreground">
                    This poll is closed. Its closing schedule cannot be changed.
                  </p>
                ) : null}
              </>
            ) : null}
          </FieldGroup>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={pending}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending
                ? "Preparing…"
                : target.item
                  ? "Save changes"
                  : "Publish demo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function EditorialDesk({
  articles,
  editions,
  polls,
  onEdit,
  onDelete,
  onClose,
}: {
  articles: HeraldArticle[];
  editions: HeraldEdition[];
  polls: HeraldPoll[];
  onEdit: (target: HeraldItem) => void;
  onDelete: (target: HeraldItem) => void;
  onClose: () => void;
}) {
  const items: HeraldItem[] = [
    ...articles.map((item) => ({ kind: "Story" as const, item })),
    ...editions.map((item) => ({ kind: "Edition" as const, item })),
    ...polls.map((item) => ({ kind: "Poll" as const, item })),
  ];
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Editorial desk</DialogTitle>
          <DialogDescription>
            Manage the shared publication. Every change records your student
            account in activity history.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col divide-y">
          {items.map((entry) => (
            <div
              key={entry.kind + entry.item.id}
              className="flex min-w-0 items-center gap-3 py-4"
            >
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{entry.kind}</p>
                <p className="text-sm font-medium break-words">
                  {entry.item.title}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onEdit(entry)}
                aria-label={"Edit " + entry.item.title}
              >
                <PencilIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onDelete(entry)}
                aria-label={"Delete " + entry.item.title}
              >
                <Trash2Icon />
              </Button>
            </div>
          ))}
          {items.length === 0 ? (
            <p>
              No content yet. Publish the first item from the newsroom toolbar.
            </p>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function HistoryDialog({
  events,
  onClose,
}: {
  events: HeraldEvent[];
  onClose: () => void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <HistoryIcon aria-hidden className="size-6 text-primary" />
          <DialogTitle>Activity history</DialogTitle>
          <DialogDescription>
            Who changed what, and when. Visible to unlocked editors and site
            admins. No content backups or restore.
          </DialogDescription>
        </DialogHeader>
        {events.length ? (
          <ol className="herald-history">
            {events.map((event) => (
              <li key={event.id}>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <strong>{event.action}</strong>
                  <span className="text-muted-foreground">{event.kind}</span>
                </div>
                <p className="font-medium break-words">{event.title}</p>
                <div className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                  <Link
                    to={"/profile/" + event.actor.pubId}
                    className="text-primary underline underline-offset-2"
                  >
                    {event.actor.name}
                  </Link>
                  <time dateTime={event.at}>
                    {new Intl.DateTimeFormat("en", {
                      dateStyle: "medium",
                      timeStyle: "short",
                      timeZone: "Asia/Seoul",
                    }).format(new Date(event.at))}{" "}
                    KST
                  </time>
                </div>
                {event.fields.length ? (
                  <p className="text-xs text-muted-foreground">
                    Fields: {event.fields.join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No changes in this preview yet.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
