import { useEffect, useRef, useState } from "react";
import { demoArticles, demoPolls } from "./content";
import { archiveEditions } from "../content/editions";
import type { HeraldEvent, HeraldItem, HeraldViewer } from "../model/types";
import { isPollClosed } from "../model/polls";
import { usePollClock } from "./use-poll-clock";

/** Ephemeral design-preview state. No credentials, edits, or votes are persisted. */
export function useHeraldDemo(viewer: HeraldViewer) {
  const [articles, setArticles] = useState(demoArticles);
  const [editions, setEditions] = useState(archiveEditions);
  const [polls, setPolls] = useState(demoPolls);
  const now = usePollClock(polls);
  const [unlocked, setUnlocked] = useState(false);
  const [password, setPassword] = useState("herald-preview");
  const [events, setEvents] = useState<HeraldEvent[]>([]);
  const urls = useRef(new Set<string>());

  useEffect(() => {
    const current = urls.current;
    return () => {
      current.forEach((url) => URL.revokeObjectURL(url));
      current.clear();
    };
  }, []);

  function fileUrl(file: File) {
    const url = URL.createObjectURL(file);
    urls.current.add(url);
    return url;
  }

  function releaseUrl(url: string | undefined) {
    if (url && urls.current.delete(url)) URL.revokeObjectURL(url);
  }

  function log(
    action: HeraldEvent["action"],
    kind: HeraldEvent["kind"],
    title: string,
    fields: string[],
  ) {
    // Audit metadata intentionally excludes old/new bodies, files, and passwords.
    const event: HeraldEvent = {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      actor: { id: viewer.id, name: viewer.name, pubId: viewer.pubId },
      action,
      kind,
      title,
      fields,
    };
    setEvents((current) => [event, ...current]);
  }

  function unlock(candidate: string) {
    // Public demo value, NOT an authorization boundary. Replace with server verification before release.
    const valid = viewer.type === "student" && candidate === password;
    setUnlocked(valid);
    return valid;
  }

  function changePassword(next: string) {
    if (viewer.role !== "admin" || next.length < 8) return;
    setPassword(next);
    setUnlocked(false);
    log("Changed password", "Access", "Herald editor access", ["password"]);
  }

  function closePoll(id: string) {
    const poll = polls.find((item) => item.id === id);
    if (!unlocked || !poll || isPollClosed(poll, Date.now())) return;
    setPolls((current) =>
      current.map((item) =>
        item.id === id ? { ...item, closed: true } : item,
      ),
    );
    log("Closed", "Poll", poll.title, ["closed"]);
  }

  function save(value: HeraldItem) {
    if (!unlocked) return;
    const id = value.item.id || crypto.randomUUID();
    let existing: object | undefined;
    let saved = value.item;
    if (value.kind === "Story") {
      const old = articles.find((item) => item.id === id);
      existing = old;
      if (old?.image !== value.item.image) releaseUrl(old?.image);
      const item = { ...value.item, id };
      setArticles((current) =>
        old
          ? current.map((entry) => (entry.id === id ? item : entry))
          : [item, ...current],
      );
    } else if (value.kind === "Edition") {
      const old = editions.find((item) => item.id === id);
      existing = old;
      if (old?.pdf !== value.item.pdf) releaseUrl(old?.pdf);
      const item = { ...value.item, id };
      setEditions((current) =>
        old
          ? current.map((entry) => (entry.id === id ? item : entry))
          : [item, ...current],
      );
    } else {
      const old = polls.find((item) => item.id === id);
      existing = old;
      if (
        old &&
        isPollClosed(old, Date.now()) &&
        value.item.closesAt !== old.closesAt
      )
        throw new Error(
          "This poll has closed. Its closing schedule cannot be changed.",
        );
      // An editor may outlive the deadline. Preserve votes and manual closure;
      // the reader's derived closed flag must not become a student audit event.
      const item = old
        ? { ...old, title: value.item.title, closesAt: value.item.closesAt }
        : { ...value.item, id };
      saved = item;
      setPolls((current) =>
        existing
          ? current.map((entry) => (entry.id === id ? item : entry))
          : [item, ...current],
      );
    }
    const fields = Object.entries(saved)
      .filter(
        ([key, next]) =>
          !["id", "date", "choice", "credit", "sample"].includes(key) &&
          (!existing ||
            JSON.stringify(Reflect.get(existing, key)) !==
              JSON.stringify(next)),
      )
      .map(([key]) => key);
    if (!existing || fields.length)
      log(
        existing ? "Edited" : "Created",
        value.kind,
        value.item.title,
        fields,
      );
  }

  function remove(value: HeraldItem) {
    if (!unlocked) return;
    if (value.kind === "Story") {
      setArticles((current) =>
        current.filter((item) => item.id !== value.item.id),
      );
      releaseUrl(value.item.image);
    }
    if (value.kind === "Edition") {
      setEditions((current) =>
        current.filter((item) => item.id !== value.item.id),
      );
      releaseUrl(value.item.pdf);
    }
    if (value.kind === "Poll")
      setPolls((current) =>
        current.filter((item) => item.id !== value.item.id),
      );
    log("Deleted", value.kind, value.item.title, []);
  }

  function vote(pollId: string, choice: string) {
    setPolls((current) =>
      current.map((poll) => {
        if (
          poll.id !== pollId ||
          isPollClosed(poll, Date.now()) ||
          !poll.options.some((option) => option.id === choice)
        )
          return poll;
        return {
          ...poll,
          choice,
          options: poll.options.map((option) => ({
            ...option,
            votes:
              option.votes -
              (option.id === poll.choice ? 1 : 0) +
              (option.id === choice ? 1 : 0),
          })),
        };
      }),
    );
  }

  return {
    articles,
    editions,
    polls: polls.map((poll) => ({ ...poll, closed: isPollClosed(poll, now) })),
    vote,
    closePoll,
    unlocked,
    unlock,
    changePassword,
    lock: () => setUnlocked(false),
    events,
    save,
    remove,
    fileUrl,
  };
}
