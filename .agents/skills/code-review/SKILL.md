---
name: code-review
description: "Review code changes along three independent axes: Correctness (bugs, security, performance, and unintended behavior), Standards (documented project rules and code smells), and Spec (the originating requirements). Use when the user wants to review uncommitted changes, a commit, a branch, a PR, work in progress since a fixed point, or request-scoped changes before implementation handoff. Runs parallel sub-agents when available and permitted, otherwise sequentially, and reports each axis separately."
---

Three-axis review of a pinned set of code changes:

- **Correctness**: does the change introduce bugs, security problems, obvious performance problems, or unintended behavior?
- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

The axes run as **parallel sub-agents** when available and permitted so they don't pollute each other's context, then this skill aggregates their findings. Otherwise perform the reviews sequentially with separate briefs and reports; do not let one axis's findings determine another axis's assessment.

Use the originating issue or specification supplied by the user or identified from repository context. This project does not require `/setup-matt-pocock-skills` or a tracker configuration skill. Fetch external issues only with an available, authorized tracker tool; if the tool or access is missing, say so and ask for the issue contents or a local specification instead.

This is a read-only review: report findings without changing files unless the user separately requests fixes and the active mode permits edits.

Do not create baseline or report files when the active mode prohibits writes. In Plan mode, retain available baseline evidence and proposed changes in the conversation. When writes are permitted, use the agent environment's approved temporary workspace outside the repository for any baseline artifacts. Do not commit, stash, reset, switch branches, install tools, or create repository files just to prepare a review.

## Process

### 1. Select and pin the review scope

First distinguish a **manual review** from the **automatic completion review** required by `AGENTS.md`. Automatic completion review uses the recorded task-start state, not the no-argument manual default below.

#### Manual review

- **No target**: review all uncommitted changes. Run `git diff` for unstaged changes, `git diff --cached` for staged changes, and `git status --short` plus `git ls-files --others --exclude-standard` for untracked files. Read new files separately. Keep index and working-tree versions distinct; do not treat the two diffs as interchangeable. Use `git diff HEAD` to understand the net tracked working-tree change where needed.
- **Commit SHA**: review that commit alone with `git show <resolved-sha>`, not all subsequent commits. A tag or commit expression explicitly requested as a single commit uses the same path.
- **Branch**: compare the current branch with the supplied branch using `git diff <branch>...HEAD`; this is a merge-base comparison. Also capture `git log <branch>..HEAD --oneline`.
- **PR URL or number**: use an available, authorized tracker tool, such as `gh pr view` for context and `gh pr diff` for the patch. Pin the PR repository and revision represented by the patch. If the tool or access is missing, request the PR description and diff rather than installing a tool or guessing. Read file context from that PR revision, not from an unrelated local checkout.
- **Explicit range, such as "since X" or "changes after X"**: resolve X as the fixed point, then use `git diff <fixed-point>...HEAD` and `git log <fixed-point>..HEAD --oneline`. Ask for the fixed point only if this range request omits it.
- **Explicit range including WIP**: resolve `git merge-base <fixed-point> HEAD` and compare that SHA to the working tree with `git diff <merge-base-sha>`. Include committed, staged, and unstaged tracked changes, and separately read relevant untracked files.

An explicit user description takes precedence over shorthand detection. Ask if a target could mean a commit, branch, or PR, or if inclusion of WIP is ambiguous. A bare SHA means a single commit; "since <SHA>" means a range.

#### Automatic completion review

At task start, record the resolved `HEAD`, the approved request, `git status --short`, staged and unstaged diffs, and relevant untracked paths and contents. Preserve pre-edit working-tree contents for relevant tracked files as well; if a file is discovered later, capture its contents before the first task edit. Include file existence and symlink targets where applicable. Do not modify the index or user's changes to obtain this record.

At completion, use that recorded start state and the task's actual edits to construct the request-scoped change set. For a file that was clean at task start, the start commit can supply its pre-task contents. For a pre-modified or untracked file, compare its saved pre-edit state to the completed state, not just `HEAD` to the working tree. Capture additions and deletions as well as modifications. Compare actual contents rather than subtracting diff text: edits can shift lines or share a hunk. Do not exclude an entire file merely because it had pre-existing user changes.

Existing user changes may be needed as context, but are not findings against this implementation. If baseline evidence is missing, a snapshot was taken only after editing, or concurrent user edits cannot be separated from task edits, ask the user to confirm the scope and report that limitation. Never silently fall back to reviewing all uncommitted changes or assume the current `HEAD` was the task-start baseline.

#### Shared scope checks

Resolve commit-based targets before diffing, for example `git rev-parse --verify --end-of-options '<ref>^{commit}'`, with the actual ref passed as a safely quoted argument. Pin relevant SHAs and capture the commands, commit list, selected patches, untracked file contents, versions, and any automatic-review exclusions once. Give every axis the same scope package; do not have each reviewer independently select targets or rediscover a mutable diff. If the checkout or PR changes during review, refresh the package and reassess affected findings.

A bad ref or unavailable PR must be resolved before launching reviewers. If the scope is empty, report "no changes to review"; count relevant untracked files before deciding that a WIP scope is empty.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched with an available, authorized tracker tool.
2. A path the user passed as an argument.
3. Follow `docs/KMLA_SPEC_INDEX.md` to the relevant domain specification and technical design. Use `docs/AGENT_MAP.md` to map changed files to their features and specifications; do not treat sections marked unimplemented as current behavior or assume the entire future design was requested.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** review will skip and report "no spec available".

Include the approved request and decisions from the current task as requirements evidence, especially for completion review. A concrete request can itself be the spec; do not require a separate issue or document when the requirements are already available. Keep its scope distinct from broader future designs. Missing specs never prevent Correctness or Standards review.

### 3. Identify the standards sources

Search the repo for every file that documents how code should be written. When `CODING_STANDARDS.md` or `CONTRIBUTING.md` exists, it must be on the list. Start with the root `AGENTS.md`, applicable feature `AGENTS.md` files, `docs/structure.md`, and `docs/README.md`. Include task-relevant policies and the skills required by the repository instructions; for DB changes include `supabase/README.md`. Use `docs/AGENT_MAP.md` for discovery and inspect actual enforcement before classifying a rule as tooling-covered. Follow local documentation links rather than assuming all conventions live in one file.

On top of whatever the repo documents, the Standards axis always carries the **smell baseline** below: a fixed set of Fowler code smells (_Refactoring_, ch.3) that applies even when a repo documents nothing. Two rules bind it:

- **The repo overrides.** A documented repo standard always wins; where it endorses something the baseline would flag, suppress the smell.
- **Always a judgement call.** Each smell is a labelled heuristic ("possible Feature Envy"), never a hard violation. Like any standard here, skip anything tooling already enforces.

Each smell reads _what it is_ → _how to fix_; match it against the diff:

- **Mysterious Name**: a function, variable, or type whose name doesn't reveal what it does or holds. → rename it; if no honest name comes, the design's murky.
- **Duplicated Code**: the same logic shape appears in more than one hunk or file in the change. → extract the shared shape, call it from both.
- **Feature Envy**: a method that reaches into another object's data more than its own. → move the method onto the data it envies.
- **Data Clumps**: the same few fields or params keep travelling together (a type wanting to be born). → bundle them into one type, pass that.
- **Primitive Obsession**: a primitive or string standing in for a domain concept that deserves its own type. → give the concept its own small type.
- **Repeated Switches**: the same `switch`/`if`-cascade on the same type recurs across the change. → replace with polymorphism, or one map both sites share.
- **Shotgun Surgery**: one logical change forces scattered edits across many files in the diff. → gather what changes together into one module.
- **Divergent Change**: one file or module is edited for several unrelated reasons. → split so each module changes for one reason.
- **Speculative Generality**: abstraction, parameters, or hooks added for needs the spec doesn't have. → delete it; inline back until a real need shows.
- **Message Chains**: long `a.b().c().d()` navigation the caller shouldn't depend on. → hide the walk behind one method on the first object.
- **Middle Man**: a class or function that mostly just delegates onward. → cut it, call the real target direct.
- **Refused Bequest**: a subclass or implementer that ignores or overrides most of what it inherits. → drop the inheritance, use composition.

### 4. Gather context and verify potential findings

**Diffs alone are not enough.** Read the entire changed files at the reviewed version, including new files, and follow relevant callers, guards, error handling, and existing patterns. For staged changes use index contents where needed; for commits and PRs use that revision's contents. For deleted files read their prior version and affected callers. Existing code is context, not a mandate to audit pre-existing defects unrelated to the change.

Correctness review focuses on:

- **Bugs**: logic and off-by-one errors, missing or incorrect guards, unreachable branches, realistic null/empty/error cases, races, and failures that are swallowed, unexpectedly thrown, or not handled by callers.
- **Security**: injection, authorization bypass, and data exposure introduced by the change.
- **Performance**: only obvious problems, such as N+1 queries, quadratic work on unbounded data, or blocking I/O on hot paths.
- **Behavior changes**: identify changed behavior, especially potentially unintended changes. State whether it conflicts with the approved request or appears intentional; do not label every intentional change a bug.

Before flagging a bug, investigate the actual control flow and a realistic failing scenario. Verify library usage and analogous project patterns with available, authorized code exploration, documentation, or search tools; no particular external service is required. Do not invent hypothetical failures or report preferences as convention violations. If a concern cannot be verified, describe it as a review limitation, not a definite defect. Communicate severity proportionately and state the inputs, environment, or conditions that make the problem occur. Keep feedback direct, factual, and actionable; omit flattery.

### 5. Run the reviews independently

When sub-agents are available and permitted, issue the available axes' calls together, in the foreground, and aggregate the reports they return. Use read-only review agents with the briefs below. Otherwise complete each brief sequentially and retain separate reports; do not merge the axes during review.

Every brief receives the same pinned scope package from step 1 and the context and verification rules from step 4. Include patches, commit lists, version-specific file contents or ways to read them, relevant untracked contents, and task-baseline exclusions. Each finding must give a file/location, severity, triggering conditions, and supporting evidence. Preserve the extra rule/spec citations required by the individual axes.

**Correctness sub-agent prompt** (or sequential review brief) should include:

- The approved request and relevant context needed to distinguish intentional from unintended behavior.
- The Correctness checklist and verification rules from step 4 pasted in full.
- The brief: "Review only the selected changes for bugs, security issues, obvious performance problems, and unintended behavior. Verify each potential defect against full file/caller context and a realistic failing scenario. Report location, proportionate severity, triggering conditions, and evidence; do not assert unverifiable concerns as bugs. Mark review limitations separately. Under 400 words."

**Standards sub-agent prompt** (or sequential review brief) should include:

- The full scope package and commit list, plus any relevant untracked file paths and contents from step 1.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** (or sequential review brief) should include:

- The same scope package and commit list, plus the same relevant untracked file paths and contents from step 1.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec review and note this in the final report.

### 6. Aggregate

Present the reports under `## Correctness`, `## Standards`, and `## Spec` headings, verbatim or lightly cleaned. If the spec is missing, retain its heading and report that the axis was skipped. Do **not** merge or rerank findings, because the axes are deliberately separate (see _Why separate axes_). Keep uncertain concerns and verification limits distinct from confirmed findings.

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## Why separate axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**
- Code that satisfies documented conventions and requirements but introduces a runtime defect they do not cover → **Standards and Spec pass, Correctness fail.**

Reporting them separately stops one axis from masking the other.
