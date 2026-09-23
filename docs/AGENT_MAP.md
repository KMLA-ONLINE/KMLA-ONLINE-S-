# Agent Map

Generated lookup tables. Rules live in `AGENTS.md`, product behavior in
`docs/KMLA_SPEC_INDEX.md`. Grep this file for the name you are holding —
`grep -n list_feed_posts docs/AGENT_MAP.md` — rather than reading it through.

Every table below is derived from the code and checked by `scripts/check-agent-map.mjs` during
`npm run check` and `npm run check:static`; `node scripts/check-agent-map.mjs --print` regenerates
them. A failure names the exact row to fix. Two exceptions are hand-written and **not** checked:
the **Spec** and **Features** columns of the route table, and the **Owns** column of the feature
table. Spec chapter numbers are stable identifiers by design, so they age slowly.

Known limit: the RPC and table scans read string literals, so a call assembled from a variable
would go unlisted.

## Routes

`app/routes.ts` is the only place URLs and nesting are declared, and **the route set is closed** —
if a change looks like it needs a new URL, say so and get the user's decision first.

**Chrome** is the resolved `header/bottomNav/contentWidth`, plus `PTR` when `pullToRefresh` is on;
an omitted `contentWidth` resolves to `4xl` (`DEFAULT_APP_CHROME` in
`app/features/app-shell/model/chrome.ts`), so a cell can name a width the file does not spell out.
`—` means the route declares no chrome at all. **Data** is `L` = `clientLoader`,
`A` = `clientAction`, `S` = `shouldRevalidate`, counted from real exports — a route that only
type-imports its parent's loader shows `—`. **Test** is the test file importing that module; `—`
means none does, and feature-level tests live under `test/features/<feature>/`.

<!-- routes:begin -->

| URL                                  | Module                                      | Chrome                        | Data  | Features                                        | Spec             | Test                                                                               |
| ------------------------------------ | ------------------------------------------- | ----------------------------- | ----- | ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `/login`                             | `app/routes/auth/login.tsx`                 | —                             | L A   | auth                                            | §4.2             | `test/routes/auth.test.tsx`                                                        |
| `/signup`                            | `app/routes/auth/signup.tsx`                | —                             | L A   | auth                                            | §4.1             | `test/routes/auth.test.tsx`                                                        |
| `/forgot-password`                   | `app/routes/auth/forgot-password.tsx`       | —                             | A     | auth                                            | §4.4             | `test/routes/password.test.tsx`                                                    |
| `/setup`                             | `app/routes/auth/setup.tsx`                 | —                             | L A   | auth                                            | §5.1–5.6         | `test/routes/auth.test.tsx`                                                        |
| `/pending`                           | `app/routes/auth/pending.tsx`               | —                             | L     | auth                                            | §5.7             | —                                                                                  |
| `/blocked`                           | `app/routes/auth/blocked.tsx`               | —                             | L     | auth                                            | §2.2, §16.2      | `test/routes/auth.test.tsx`                                                        |
| `/logout`                            | `app/routes/auth/logout.tsx`                | —                             | A     | auth                                            | §4.3             | —                                                                                  |
| `/noti/open/:notificationId`         | `app/routes/notification-open.tsx`          | —                             | L     | notifications                                   | §14.1            | `test/routes/notification-open.test.tsx`                                           |
| `/dokkaebi`                          | `app/routes/dokkaebi.tsx`                   | —                             | —     | —                                               | none             | —                                                                                  |
| `(layout)`                           | `app/routes/app/gate.tsx`                   | —                             | L S   | app-shell, notifications                        | §2.2, §4         | `test/routes/app/gate.test.ts`                                                     |
| `(layout)`                           | `app/routes/app/layout.tsx`                 | —                             | —     | app-shell, feed, groups, notifications, stories | §3.1, §3.2       | —                                                                                  |
| `/`                                  | `app/routes/app/home.tsx`                   | sticky/hide-on-scroll/5xl/PTR | L S   | feed, stories, meal, profiles, search           | §6               | `test/routes/app/home.test.ts`                                                     |
| `/feed/posts/:postId`                | `app/routes/app/feed/post-data.ts`          | —                             | L     | feed, groups, posts                             | §8.8             | `test/routes/app/feed-post-data.test.ts`                                           |
| `/profile`                           | `app/routes/app/profile/index.tsx`          | sticky/none/4xl               | —     | app-shell                                       | §12.1            | —                                                                                  |
| `/noti`                              | `app/routes/app/notifications.tsx`          | sticky/sticky/4xl/PTR         | L A   | notifications                                   | §14.1            | `test/routes/app/notifications.test.ts`                                            |
| `/noti/page`                         | `app/routes/app/notification-page.ts`       | —                             | L S   | notifications                                   | §14.1            | `test/routes/app/notification-page.test.ts`                                        |
| `/noti/settings`                     | `app/routes/app/notification-settings.tsx`  | sticky/none/2xl               | L A   | notifications                                   | §15.2, §7.16     | `test/routes/app/notification-settings.test.ts`                                    |
| `/menu`                              | `app/routes/app/menu/index.tsx`             | sticky/sticky/4xl             | —     | app-shell, auth                                 | §15.1            | `test/routes/app/menu.test.tsx`                                                    |
| `/menu/licenses`                     | `app/routes/app/menu/licenses.tsx`          | sticky/sticky/4xl             | —     | app-shell                                       | §15.7            | —                                                                                  |
| `/menu/birthdays`                    | `app/routes/app/menu/birthdays.tsx`         | sticky/none/5xl               | L     | profiles                                        | §17.5, §17.8     | `test/routes/app/menu/birthdays.test.ts`                                           |
| `/menu/meal`                         | `app/routes/app/menu/meal.tsx`              | sticky/sticky/5xl             | L     | meal                                            | §17.4            | —                                                                                  |
| `/menu/story`                        | `app/routes/app/menu/story.tsx`             | sticky/sticky/4xl             | L     | stories                                         | §17.6            | —                                                                                  |
| `/menu/password`                     | `app/routes/app/menu/password.tsx`          | sticky/sticky/4xl             | A     | auth                                            | §4.5             | `test/routes/password.test.tsx`                                                    |
| `/menu/settings`                     | `app/routes/app/menu/settings.tsx`          | sticky/sticky/4xl             | —     | app-shell                                       | §15.3            | `test/routes/app/menu/settings.test.tsx`                                           |
| `/menu/settings/lab`                 | `app/routes/app/menu/settings-lab.tsx`      | sticky/sticky/4xl             | —     | posts                                           | §15.4, §15.5     | `test/routes/app/menu/settings-lab.test.tsx`                                       |
| `/menu/timetable`                    | `app/routes/app/menu/timetable.tsx`         | sticky/none/5xl               | —     | timetable                                       | §17.7            | —                                                                                  |
| `/support`                           | `app/routes/app/support.tsx`                | sticky/none/2xl               | —     | support                                         | §15.11           | —                                                                                  |
| `/update`                            | `app/routes/app/update.tsx`                 | sticky/none/2xl               | —     | support                                         | §15.12           | —                                                                                  |
| `/util/gongang`                      | `app/routes/app/util/gongang.tsx`           | sticky/none/5xl               | —     | school-utilities                                | §17.1            | —                                                                                  |
| `/util/gongang/manage`               | `app/routes/app/util/gongang-manage.tsx`    | sticky/none/5xl               | —     | school-utilities                                | §17.1, §16.6     | —                                                                                  |
| `/util/karaoke`                      | `app/routes/app/util/karaoke.tsx`           | sticky/none/5xl               | —     | school-utilities                                | §17.2            | —                                                                                  |
| `/groups`                            | `app/routes/app/groups/index.tsx`           | sticky/sticky/4xl/PTR         | L A S | groups, feed                                    | §7.2, §7.3       | `test/routes/app/groups/index.test.ts`                                             |
| `/groups/discover`                   | `app/routes/app/groups/discover.tsx`        | sticky/sticky/4xl/PTR         | L A   | groups, feed                                    | §7.4             | —                                                                                  |
| `/groups/member-page`                | `app/routes/app/groups/member-page.ts`      | —                             | L     | groups                                          | §7.9             | `test/routes/app/groups/member-page.test.ts`                                       |
| `/groups/report-page`                | `app/routes/app/groups/report-page.ts`      | —                             | L     | posts                                           | §8.15            | —                                                                                  |
| `/invite/:token`                     | `app/routes/app/invite.tsx`                 | sticky/none/2xl               | L A   | groups, feed                                    | §7.6             | —                                                                                  |
| `/profile/:pubId`                    | `app/routes/app/profile/detail.tsx`         | sticky/none/5xl               | L A S | profiles, posts                                 | §12.1, §12.4     | `test/routes/app/profile/detail.test.ts`                                           |
| `/profile/:pubId/posts/new`          | `app/routes/app/profile/post-new.tsx`       | sticky/none/4xl               | —     | posts                                           | §8.4             | `test/routes/app/profile/post-routes.test.ts`                                      |
| `/profile/:pubId/posts/:postId`      | `app/routes/app/profile/post.tsx`           | sticky/none/5xl               | L A S | posts                                           | §8.8, §9, §10    | `test/routes/app/profile/post-routes.test.ts`                                      |
| `/profile/:pubId/posts/:postId/edit` | `app/routes/app/profile/post-edit.tsx`      | sticky/none/4xl               | L     | posts                                           | §8.10            | `test/routes/app/profile/post-routes.test.ts`                                      |
| `/profile/:pubId/edit`               | `app/routes/app/profile/edit.tsx`           | sticky/none/5xl               | L A   | profiles                                        | §12.2, §12.3     | `test/routes/app/profile/edit.test.ts`                                             |
| `/groups/create`                     | `app/routes/app/groups/create.tsx`          | sticky/none/2xl               | A     | groups                                          | §7.7             | —                                                                                  |
| `/groups/:slug`                      | `app/routes/app/groups/detail.tsx`          | sticky/none/5xl/PTR           | L A S | groups, posts, feed                             | §7.8–7.17, §8.15 | `test/routes/app/groups/detail.test.ts`                                            |
| `/groups/:slug/posts/new`            | `app/routes/app/groups/post-new.tsx`        | sticky/none/4xl               | —     | posts, groups                                   | §8.3, §8.5       | `test/routes/app/groups/post-routes.test.tsx`                                      |
| `/groups/:slug/posts/:postId`        | `app/routes/app/groups/post.tsx`            | sticky/none/5xl               | L A S | posts, groups                                   | §8.8, §9, §10    | `test/routes/app/groups/post-routes.test.tsx`                                      |
| `/groups/:slug/posts/:postId/edit`   | `app/routes/app/groups/post-edit.tsx`       | sticky/none/4xl               | L     | posts                                           | §8.10            | `test/routes/app/groups/post-routes.test.tsx`                                      |
| `/admin`                             | `app/routes/app/admin/index.tsx`            | sticky/none/4xl               | L     | admin                                           | §16              | —                                                                                  |
| `/admin/approvals`                   | `app/routes/app/admin/approvals.tsx`        | sticky/none/5xl/PTR           | L A   | admin, profiles                                 | §16.1, §16.2     | `test/routes/app/admin/actions.test.ts`, `test/routes/app/admin/approvals.test.ts` |
| `/admin/gongang-managers`            | `app/routes/app/admin/gongang-managers.tsx` | sticky/none/5xl               | L A   | admin                                           | §16.6            | —                                                                                  |
| `/admin/app-admins`                  | `app/routes/app/admin/app-admins.tsx`       | sticky/none/5xl               | L A   | admin                                           | §16.3–16.5       | `test/routes/app/admin/actions.test.ts`                                            |
| `/admin/storage-cleanup`             | `app/routes/app/admin/storage-cleanup.tsx`  | sticky/none/5xl/PTR           | L     | admin                                           | §16.7            | `test/routes/app/admin/storage-cleanup.test.ts`                                    |
| `(layout)`                           | `app/routes/messenger/layout.tsx`           | —                             | —     | app-shell                                       | §13              | —                                                                                  |
| `/messenger`                         | `app/routes/messenger/index.tsx`            | —                             | —     | messaging                                       | §13.2            | —                                                                                  |
| `/messenger/:roomId`                 | `app/routes/messenger/room.tsx`             | —                             | —     | messaging                                       | §13.3            | —                                                                                  |
| `/*`                                 | `app/routes/catch-all.tsx`                  | —                             | —     | —                                               | none             | —                                                                                  |

<!-- routes:end -->

## Features

`index.ts` is the public API — prefer `~/features/<name>`. `stories` has no `index.ts` and
`notifications` exports no components, so both are imported by module path.

<!-- features:begin -->

| Feature            | Owns                                                                                                                                        | Spec                                                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `admin`            | Approval review, admin roster, permission-based managers, storage cleanup status                                                            | §16                                                 |
| `app-shell`        | Header, sidebar, tab bar, `PageHeader`, `ScrollRegion`, pull-to-refresh, shell data, `handle.chrome`                                        | §3                                                  |
| `auth`             | Sign-up, login, OTP, password reset and change, profile setup, signup draft                                                                 | §4, §5                                              |
| `feed`             | Home integrated feed, infinite feed session, feed cache surgery                                                                             | §6 and `docs/FEED_ALGORITHM.md`                     |
| `groups`           | Group home, discover, detail, membership, roles, invites, group settings, group media                                                       | §7                                                  |
| `meal`             | NEIS meal fetch and meal screens                                                                                                            | §17.4                                               |
| `messaging`        | Messenger screens — **shell only, unimplemented**                                                                                           | §13                                                 |
| `notifications`    | Inbox, badges, delivery preferences, Web Push subscribe and unsubscribe, realtime sync                                                      | §14, §15.2, `docs/NOTIFICATION_TECHNICAL_DESIGN.md` |
| `posts`            | Posts, comments, reactions, mentions, attachments, markdown, categories, reports, anonymity — **read `app/features/posts/AGENTS.md` first** | §8–§11, `docs/CONTENT_FORMATTING.md`                |
| `profiles`         | Profile view and edit, profile media, birthdays                                                                                             | §12, §17.5                                          |
| `school-utilities` | Gongang and karaoke reservations, gongang schedule manager                                                                                  | §17.1–17.3                                          |
| `search`           | Global search dialog, directory search, recent searches                                                                                     | §3.3, §3.6                                          |
| `stories`          | Today's story rail and story editor                                                                                                         | §17.6, §6.6                                         |
| `support`          | FAQ and release notes — static content in `content/`, no Supabase                                                                           | §15.11, §15.12                                      |
| `timetable`        | Personal timetable, backed by local storage                                                                                                 | §17.7                                               |

<!-- features:end -->

## RPC

Every Supabase call lives in a feature's `data/`. **Called from** is relative to `app/features/`,
**Defined in** relative to `supabase/schemas/`.

<!-- rpc:begin -->

| RPC                                           | Called from                                                                     | Defined in                    |
| --------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------- |
| `accept_group_invite`                         | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `admin_list_accepted_users`                   | `admin/data/queries.ts`                                                         | `13-administration.sql`       |
| `admin_list_applications`                     | `admin/data/queries.ts`                                                         | `13-administration.sql`       |
| `admin_list_members`                          | `admin/data/queries.ts`                                                         | `13-administration.sql`       |
| `admin_review_applications`                   | `admin/data/mutations.ts`                                                       | `13-administration.sql`       |
| `admin_set_app_admin`                         | `admin/data/mutations.ts`                                                       | `13-administration.sql`       |
| `admin_set_gongang_manager`                   | `admin/data/mutations.ts`                                                       | `13-administration.sql`       |
| `admin_storage_cleanup_status`                | `admin/data/queries.ts`                                                         | `82-storage-cleanup.sql`      |
| `admin_unblock_application`                   | `admin/data/mutations.ts`                                                       | `13-administration.sql`       |
| `approve_group_join_request`                  | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `cancel_group_anonymous_activity_restriction` | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `cancel_utility_reservation`                  | `school-utilities/data/reservations.ts`                                         | `51-utility-reservations.sql` |
| `clear_comment_reaction`                      | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `clear_post_reaction`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `commit_group_post`                           | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `commit_profile_post`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `create_group`                                | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `create_group_category`                       | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `create_group_post`                           | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `create_group_post_upload_draft`              | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `create_post_comment`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `create_profile_post`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `delete_group`                                | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `delete_group_category`                       | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `delete_group_post`                           | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `delete_my_story`                             | `stories/data/mutations.ts`                                                     | `42-stories.sql`              |
| `delete_post_attachment`                      | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `delete_post_comment`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `delete_profile_post`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `discover_groups`                             | `groups/data/queries.ts`                                                        | `21-groups.sql`               |
| `dismiss_group_post_reports`                  | `posts/data/group-reports.ts`                                                   | `35-moderation.sql`           |
| `finalize_comment_image`                      | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `finalize_group_media`                        | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `finalize_post_attachment`                    | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `finalize_profile_media`                      | `profiles/data/media.ts`                                                        | `11-identity.sql`             |
| `get_accepted_profile`                        | `profiles/data/queries.ts`                                                      | `11-identity.sql`             |
| `get_group_invite`                            | `groups/data/queries.ts`                                                        | `21-groups.sql`               |
| `get_group_invite_preview`                    | `groups/data/queries.ts`                                                        | `21-groups.sql`               |
| `get_group_post`                              | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `get_my_group_anonymous_activity_restriction` | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `get_my_group_new_post_counts`                | `groups/data/queries.ts`                                                        | `31-posts.sql`                |
| `get_my_notification_preferences`             | `notifications/data/queries.ts`                                                 | `61-notifications.sql`        |
| `get_my_profile`                              | `app-shell/data/queries.ts`, `auth/data/queries.ts`, `profiles/data/queries.ts` | `11-identity.sql`             |
| `get_my_recent_unread_notification_count`     | `notifications/data/queries.ts`                                                 | `61-notifications.sql`        |
| `get_my_web_push_status`                      | `notifications/data/push.ts`                                                    | `61-notifications.sql`        |
| `get_profile_post`                            | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `issue_group_invite`                          | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `list_birthdays`                              | `profiles/data/queries.ts`                                                      | `11-identity.sql`             |
| `list_comment_images`                         | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_comment_reactors`                       | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_feed_posts`                             | `feed/data/queries.ts`                                                          | `41-feed.sql`                 |
| `list_group_join_requests`                    | `groups/data/queries.ts`                                                        | `21-groups.sql`               |
| `list_group_members`                          | `groups/data/queries.ts`                                                        | `21-groups.sql`               |
| `list_group_post_report_descriptions`         | `posts/data/group-reports.ts`                                                   | `35-moderation.sql`           |
| `list_group_post_report_summaries`            | `posts/data/group-reports.ts`                                                   | `35-moderation.sql`           |
| `list_group_posts`                            | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_my_notifications`                       | `notifications/data/queries.ts`                                                 | `61-notifications.sql`        |
| `list_post_attachments`                       | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_post_comment_replies`                   | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_post_comments`                          | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_post_reactors`                          | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_profile_posts`                          | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `list_today_stories`                          | `stories/data/queries.ts`                                                       | `42-stories.sql`              |
| `mark_all_my_notifications_read`              | `notifications/data/mutations.ts`                                               | `61-notifications.sql`        |
| `mark_group_posts_visited`                    | `groups/data/mutations.ts`                                                      | `31-posts.sql`                |
| `mark_my_notification_read`                   | `notifications/data/mutations.ts`                                               | `61-notifications.sql`        |
| `move_group_category`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `prepare_comment_image`                       | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `prepare_group_media`                         | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `prepare_post_attachment`                     | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `prepare_profile_media`                       | `profiles/data/media.ts`                                                        | `11-identity.sql`             |
| `register_my_web_push_subscription`           | `notifications/data/push.ts`                                                    | `61-notifications.sql`        |
| `reject_group_join_request`                   | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `remove_group_media`                          | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `remove_my_profile_media`                     | `profiles/data/media.ts`                                                        | `11-identity.sql`             |
| `report_group_post`                           | `posts/data/group-reports.ts`                                                   | `35-moderation.sql`           |
| `resolve_my_notification_destination`         | `notifications/data/queries.ts`                                                 | `61-notifications.sql`        |
| `restrict_group_anonymous_activity`           | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `revoke_group_invite`                         | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `search_directory`                            | `search/data/queries.ts`                                                        | `53-search.sql`               |
| `search_group_mention_candidates`             | `posts/data/queries.ts`                                                         | `21-groups.sql`               |
| `search_group_posts`                          | `posts/data/queries.ts`                                                         | `34-content-api.sql`          |
| `set_comment_reaction`                        | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `set_group_post_pinned`                       | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `set_my_group_notification_preferences`       | `notifications/data/mutations.ts`                                               | `61-notifications.sql`        |
| `set_my_story`                                | `stories/data/mutations.ts`                                                     | `42-stories.sql`              |
| `set_post_reaction`                           | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `submit_my_profile`                           | `auth/data/mutations.ts`                                                        | `11-identity.sql`             |
| `transfer_group_ownership`                    | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `unregister_my_web_push_subscription`         | `notifications/data/push.ts`                                                    | `61-notifications.sql`        |
| `update_group_category`                       | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `update_group_member_role`                    | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `update_group_post_draft_identity`            | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |
| `update_group_settings`                       | `groups/data/mutations.ts`                                                      | `21-groups.sql`               |
| `update_my_notification_preferences`          | `notifications/data/mutations.ts`                                               | `61-notifications.sql`        |
| `update_my_profile`                           | `profiles/data/mutations.ts`                                                    | `11-identity.sql`             |
| `update_post_comment`                         | `posts/data/mutations.ts`                                                       | `34-content-api.sql`          |

<!-- rpc:end -->

## Direct table access

Everything not above goes through the table API under RLS. This is the complete set of tables the
browser reads or writes directly.

<!-- tables:begin -->

| Table                  | Accessed from                                                                         |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `gongang_schedule`     | `school-utilities/data/gongang-schedule.ts`                                           |
| `group_categories`     | `posts/data/queries.ts`                                                               |
| `group_join_requests`  | `groups/data/mutations.ts`, `groups/data/queries.ts`                                  |
| `group_memberships`    | `groups/data/mutations.ts`, `groups/data/queries.ts`, `notifications/data/queries.ts` |
| `groups`               | `groups/data/queries.ts`                                                              |
| `post_attachments`     | `posts/data/queries.ts`                                                               |
| `profile_departments`  | `profiles/data/queries.ts`                                                            |
| `profile_permissions`  | `school-utilities/data/gongang-schedule.ts`                                           |
| `user_timetables`      | `timetable/data/timetable.ts`                                                         |
| `utility_reservations` | `school-utilities/data/reservations.ts`                                               |

<!-- tables:end -->
