# Herald feature

Owns the Minjok Herald design preview at `/menu/herald`. Product decisions live in
[school features](../../../docs/functional-spec/school-features.md#1711-minjok-herald);
the [technical design](../../../docs/HERALD_TECHNICAL_DESIGN.md) separates this preview
from the unbuilt production system.

- Both Classic and Magazine render the same content and poll state. Keep layout independent of editing and voting.
- The supplied banner and motto are the publication identity. Preserve the banner artwork in both themes.
- `content/editions.ts` is the permanent repository archive, ordered by issue descending. Show the newest edition as the feature, the next four in the sidebar, and every edition in the archive dialog. Do not invent missing issues or substitute draft documents for final PDFs.
- PDFs in `public/herald/` and `public/herald/editions/` ship with the static build. Their direct URLs are public even though the Herald page stays behind the existing sign-in gate. Add or replace canonical archive items through a PR; local editor changes remain a demo and reset on reload.
- The existing app gate owns sign-in, approval, suspension, and terms. Do not add another gate here.
- `demo/` is explicitly ephemeral UI state, not a database mock or authorization boundary. No Herald data, passwords, votes, or history enter persistent browser storage. Remount on account identity changes.
- Any student can unlock with the demo password, irrespective of role. Admin status alone allows password management and history, not student editing.
- Public bylines say Minjok Herald. History records the actual shell profile and metadata only: timestamp, action, item title, changed field names. Never retain article bodies, before/after values, file copies, or passwords in history. No restore action.
- Unlocked editors and site admins can view history; ordinary readers cannot. This is presentation-only until server authorization is built.
- One single-choice vote per viewer; changing it moves the vote, and closing reveals totals and prevents votes. Readers never see voter identities.
- `PollShelf` limits the sidebar to two current poll cards and four compact past-poll links. The full archive lists all current and closed polls; opening a row renders one interactive poll. Do not restore an unbounded stack of cards.
- Polls may have an optional `closesAt` instant. Editors enter a date and 12-hour AM/PM time explicitly in KST; store UTC ISO, never browser-local time. The same deadline predicate controls visibility and the vote handler, which rechecks the actual clock at click time. Manual close ends voting early. Closed polls cannot be reopened by changing their schedule.
- A single screen timer targets the next deadline and catches up on window focus/visibility changes. Automatic closure is derived from the deadline and is not falsely attributed to the student viewing the page. History records the student who set/changed the schedule and who manually closed a poll.
- Blob URLs are page-owned and revoked on replacement, deletion, or unmount. Prototype files do not upload anywhere.
- Keep theme colors semantic. White text on darkened photographs is intentional; blue solid controls use action tokens.
- `public/herald/` contains supplied historical editions, banner artwork and credited stock placeholders. `public/herald/covers/` contains first-page PDF renders. Article text remains illustrative; do not infer that the stock campus depicts KMLA. The technical design records provenance.
- Future Supabase I/O belongs in `data/`; replace the demo hook rather than adding database calls in components. Follow database workflow and red-first authorization tests before connecting production writes.

- Story sections are Feature, News, Editorial, and misc, shared by the editor and reader filter. Do not restore the generic newsroom promotional block.
- Story photo paste uses the editor’s ordinary file validation and page-owned blob URL lifecycle. Only image clipboard files replace the chosen photo; text paste remains native. One photo per story.
