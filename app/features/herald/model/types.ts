export const heraldCategories = [
  "Feature",
  "News",
  "Editorial",
  "misc",
] as const;
export type HeraldCategory = (typeof heraldCategories)[number];

export interface HeraldViewer {
  id: number;
  pubId: string;
  name: string;
  type: "student" | "teacher" | "alumni";
  role: "member" | "admin";
}

export interface HeraldArticle {
  id: string;
  title: string;
  category: HeraldCategory;
  deck: string;
  body: string;
  image: string;
  credit: string;
  date: string;
}

export interface HeraldEdition {
  id: string;
  title: string;
  issue: string;
  season: string;
  cover?: string;
  pdf?: string;
  pages?: number;
  sample?: boolean;
}

export interface HeraldPoll {
  id: string;
  title: string;
  options: { id: string; label: string; votes: number }[];
  choice: string | null;
  closed: boolean;
  /** Absolute closing instant; editors enter it in Korea time. */
  closesAt?: string;
}

export interface HeraldEvent {
  id: string;
  at: string;
  actor: Pick<HeraldViewer, "id" | "pubId" | "name">;
  action: "Created" | "Edited" | "Deleted" | "Closed" | "Changed password";
  kind: "Story" | "Edition" | "Poll" | "Access";
  title: string;
  fields: string[];
}

export type HeraldItem =
  | { kind: "Story"; item: HeraldArticle }
  | { kind: "Edition"; item: HeraldEdition }
  | { kind: "Poll"; item: HeraldPoll };

export type HeraldEditorTarget =
  | { kind: "Story"; item?: HeraldArticle }
  | { kind: "Edition"; item?: HeraldEdition }
  | { kind: "Poll"; item?: HeraldPoll };
