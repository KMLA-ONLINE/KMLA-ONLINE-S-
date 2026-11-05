# Minjok Herald technical design

The product rules are in [§17.11](functional-spec/school-features.md#1711-minjok-herald).
This document describes the implemented visual preview and the proposed production work.
It does not claim that a database, secure editorial access, or durable history exists.

## Implemented preview

`/menu/herald` sits inside the existing signed-in, approved-member shell. The menu tile
follows donations. The supplied illustrated banner and the user’s motto identify the publication. Classic uses ruled columns and newspaper cards;
Magazine uses image headlines and a right-hand editions shelf. Mobile stacks the shelf
below the stories. Both use the app's light/dark theme tokens and shared controls.

The preview supports section filtering, article reading, 24 supplied historical PDFs with their
actual covers, a near-full-window PDF reader, single-choice voting and changing a vote, poll closing,
student editor unlock, creating/editing/deleting stories, editions and polls, admin password
changes, and metadata-only activity history. Password rotation locks the local editor.
Existing poll options remain fixed in this preview. The question and an optional closing
schedule can be edited while the poll is open; after closure the schedule stays fixed.
The sidebar shows at most two current poll cards and four compact past-poll links. A bounded,
scrollable archive keeps every poll accessible without stretching the page beside the articles.
Readers open a poll from that list to vote or see its results.

Story sections are Feature, News, Editorial, and misc. The generic newsroom promotional block is removed. Editors can choose a photo from disk or paste an image into any editor field (Ctrl+V / ⌘V); ordinary text paste remains native. Pasting selects the first image, replaces the pending photo, and uses the same JPEG/PNG/WebP and 30 MB validation on publish. The selected filename is shown and can be removed.

The initial password is `herald-preview`. This is a public demonstration value. The historical
archive is permanent repository content; editor changes, passwords, votes and activity history
are React state and reset on reload, route unmount or account change. Files selected in the editor use
object URLs and are never uploaded. The preview's 30 MB upload ceiling and 2–6 poll choices
are demonstration limits, not settled production policy. The initial vote counts are sample data.
The real account's name appears in local history; records contain no content snapshots or restore.

The historical PDFs, banner and photographs in `public/herald/` are static, publicly addressable assets.
The app route's sign-in gate does not protect these asset URLs. Herald reading continues to require
sign-in. The PR-managed archive
is shipped with the static site. Future uploads that require member-only file access must use private
Storage. Nothing was deployed as part of this work.

## Production implementation sequence

> **상태**: 미구현

### 1. Editorial access and database boundary

Keep the existing shell gate. Enforce approval, suspension and student eligibility again on
the server for every editorial operation. A student with the shared password can edit
regardless of role; only site admins can set or rotate the password. History is readable
by unlocked editors and site admins. Publishing always presents Minjok Herald as the author.

Propose a password hash in a private relation with no browser grants, verified by a narrowly
scoped Edge Function or transactional RPC. Never return the hash, store plaintext, embed a
real password in the frontend, or use a `VITE_*` secret. Rate-limit verification on the server.
Bind temporary editor access to the authenticated user and Auth session, with an explicit
expiry and password version. Every write rechecks that capability, account status and version;
rotation revokes previous grants. Admin password changes do not silently unlock publishing.
The exact expiry and rate limits remain to be selected before production implementation.

Add separate Herald article, edition, poll, option and vote relations; do not reuse ephemeral
24-hour stories or ordinary social posts. Use schema-first DDL, explicit grants/RLS, reviewed
migrations and generated database types. Security-definer functions, where needed, authorize
internally with an empty search path and restricted execution grants.

### 2. Durable publishing, files and activity history

Store article text/category/media, edition title/issue/PDF metadata and poll questions/options.
Use transactional mutations for each content change and its audit event so they either both
commit or neither does. Derive the actor from authenticated identity, never a submitted name.
Keep a stable content ID and event metadata: actor, server timestamp, action, item title and
changed field names. Deleting an item must not cascade-delete its events. Readers cannot
query the audit relation directly; use an authorized, paginated screen read.

Audit entries are append-only to clients. They do not contain old/new bodies, media copies,
password values, diffs or restore data. Deleted content is not recoverable through Herald.
Identity after account withdrawal and audit retention must be reconciled with the existing
[deletion policy](DELETION_POLICY.md) before launch. “No backups” describes the requested
Herald history behavior; infrastructure backup retention is a separate deployment policy.

Use private Storage and short-lived signed URLs following the existing
[Storage](STORAGE_BUCKETS.md) and [cache](DATA_CACHE_POLICY.md) policies. Keep prepare/upload/
finalize, progress, retries and orphan cleanup together in `herald/data/files.ts`. Validate
actual image/PDF bytes, enforce server-side limits and generate thumbnails. Finalize ownership
and access atomically. PDF size limits, multi-image posts and rich-text scope remain decisions
for the production pass. The preview currently demonstrates one image and plain text per story.

### 3. Poll integrity and frontend integration

Enforce a unique `(poll_id, voter_id)` record and require a valid option of that poll. Voting
upserts the caller's single choice, never a client-supplied tally. Serialize vote/close operations
so a vote cannot sneak in after closure. Expose presentation-safe aggregates only after the
caller has voted or the poll has closed; do not expose voter identities to readers.
Poll deadlines are optional and entered as a KST date plus 12-hour AM/PM time, then stored as
a UTC ISO instant. Noon and midnight must not depend on the browser’s timezone. Reject past
deadlines on create/update; manual closure can end voting early, and a closed poll cannot be
reopened by editing its schedule. Production voting must check the database clock against the
deadline inside the same transaction that writes a vote; it must remain closed even if no page
is open or a background job runs late. A cron job is not the authorization boundary.

In the preview, `model/polls.ts` owns conversion, display and effective closure. One screen timer
refreshes the UI at the next deadline and on focus/visibility events. The vote handler independently
checks `Date.now()` to reject a click after the deadline before a delayed timer has refreshed the UI.
Automatic closure is a derived state, not a content mutation attributed to the reader. Audit the
student’s schedule edits and manual closure; any future server-generated expiry event must use a
system actor. Production option-editing policy remains to be settled.

Replace `demo/use-herald-demo.ts` with a narrow feature data API. Use route `clientLoader`/
`clientAction` for screen reads and route forms, with upload work retained in the feature.
Fetch independent screen data in parallel, batch signed URLs, and avoid per-card requests.
Return canonical mutation results and refresh the affected content/history/poll queries.
Do not persist protected content or editor capabilities to localStorage. Clear account-scoped
state when authentication changes. Both layouts keep the same data and interaction contracts.

### 4. Verification and release

Write failing pgTAP tests first for locked/wrong-password/non-student/expired/rotated access,
admin password management, history visibility and atomic logging, vote uniqueness, private
voter identities and close-vote races. Test denied direct table writes and Storage access too.
Add app tests for loading, errors, upload retry/cleanup and refresh after every mutation.
Exercise both layouts, theme settings, mobile, keyboard, PDF fallback and all editor flows
against the real backend with Playwright.

Follow the [database workflow](../supabase/README.md): reset, pgTAP, lint, advisors, generated
types and drift checks, then verify the dev deployment. Document any new project secrets and
Storage configuration. Hand over the tested commit and remaining configuration for the user's
Production Environment approval; agents do not deploy production.

## Preview asset provenance

- `70th-edition.pdf` is the supplied `Minjok Herald_70th Edition_PDF Version.pdf` (48 pages).
- `edition-70.jpg` is its extracted cover image.
- `the-scene.jpg` and `interview.jpg` are extracted photographs from the supplied Facebook PDF.
- `campus.jpg`: [Tim Alex on Unsplash](https://unsplash.com/photos/person-walking-on-pathway-in-front-of-brown-concrete-building-during-daytime-JYqLCa-rv7o), a stock campus placeholder, not a photograph of KMLA.
- `library.jpg`: [Emil Widlund on Unsplash](https://unsplash.com/photos/assorted-books-ZtI4l8EvyUw).
- `banner.png` is the supplied Minjok Herald cherry-blossom artwork, copied without modifying the source.
- The archive contains the 24 PDFs in the supplied `Old Editions PDF-20261104T155053Z-1-001.zip`.
  The existing 70th-edition file is identical and reused. Each other original PDF is in
  `public/herald/editions/`; all cover thumbnails in `public/herald/covers/` are first-page renders.
  The original ZIP, drafts, recordings, surveys and PowerPoint were not added to the repository.
- All preview article text remains illustrative. It does not assert real reporting, interviews or
  quotes. Photo credits appear in the reader where known.

## Permanent archive and PR workflow

`app/features/herald/content/editions.ts` is the canonical catalog, ordered by issue number
from newest to oldest. It records the source filename in a comment and the stable ID, issue,
title, display date/label, PDF URL, cover URL and page count. Missing issue numbers are gaps
in the supplied collection; do not generate placeholder editions for them. The latest issue
is featured separately, the sidebar lists the next four, and **View all editions** opens the
full scrollable archive. Choosing an edition opens the same large PDF reader.

The catalog currently contains issues 72, 71, 70, 69, 68, 67, 65, 60, 59, 57, 56, 55, 54,
53, 52, 50, 49, 48, 47, 46, 44, 43, 2 and 1. The original PDFs total 382,734,715 bytes
(about 365 MiB); the largest is 48,718,029 bytes. Keep PDFs out of service-worker precaching.
The existing build script only precaches its configured app-shell asset extensions, excluding
PDFs; reading an edition requests its file on demand.

To add another final edition through a PR:

1. Copy only the final PDF into `public/herald/editions/` using a stable issue filename.
   Preserve the supplied original; do not overwrite an existing issue without checking it.
2. Render its first page to a small JPEG in `public/herald/covers/`. Inspect that cover and
   verify the issue, title, date and page count. Add a catalog entry in newest-first order.
3. Check the complete archive, PDF open/download links, layout and the production build.
   Verify that the built PDFs match the originals. Commit the files, catalog and any source notes
   together. No database migration or manual server upload is needed for this static archive.
4. Open the PR and follow the normal CI, merge and release workflow. A pushed PR is reviewable
   source, not proof that production was updated. Agents do not trigger production releases.

[GitHub’s file-size guidance](https://docs.github.com/en/repositories/working-with-files/managing-large-files/about-large-files-on-github)
warns above 50 MiB and blocks regular Git files above 100 MiB. All supplied PDFs fit under those
thresholds, though the collection increases repository size. Future archive growth may justify
object storage with a catalog in Git. Vercel Git integration and actual project deployment settings
must be checked when publishing; this change did not inspect or modify remote hosting settings.

Source reconciliation: `MH Final Version for real.pdf` identifies itself as the 68th edition,
September 2023, on the cover. The file labeled 56th has a cover printed “57th”; its supplied
archive sequence is retained as 56th. Some filename month codes differ from their printed cover
dates (46th, 59th, 60th, 67th); display labels follow the printed cover. Issues with no verified
cover date use a neutral label. No print content was corrected or rewritten.
