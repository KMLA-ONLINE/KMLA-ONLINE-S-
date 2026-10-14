---
name: code-review
description: 'Review changes since a fixed point (commit, branch, tag, or merge-base), including uncommitted changes when reviewing work in progress, along two axes: Standards (does the code follow this repo''s documented coding standards?) and Spec (does the code match the originating issue/spec?). Runs independent reviews in parallel sub-agents when available and permitted, otherwise sequentially, and reports them side by side. Use when the user wants to review a branch, a PR, work-in-progress changes, or asks to "review since X".'
---

Two-axis review of the diff between `HEAD` (plus uncommitted changes for a WIP review) and a fixed point the user supplies:

- **Standards**: does the code conform to this repo's documented coding standards?
- **Spec**: does the code faithfully implement the originating issue / spec?

Both axes run as **parallel sub-agents** when available and permitted so they don't pollute each other's context, then this skill aggregates their findings. Otherwise perform the two reviews sequentially with separate briefs and reports; do not let one axis's findings determine the other axis's assessment.

Use the originating issue or specification supplied by the user or identified from repository context. This project does not require `/setup-matt-pocock-skills` or a tracker configuration skill. Fetch external issues only with an available, authorized tracker tool; if the tool or access is missing, say so and ask for the issue contents or a local specification instead.

This is a read-only review: report findings without changing files unless the user separately requests fixes and the active mode permits edits.

## Process

### 1. Pin the fixed point

Whatever the user said is the fixed point (a commit SHA, branch name, tag, `main`, `HEAD~5`, etc.). If they didn't specify one, ask for it.

For a branch or committed-change review, capture the diff command once: `git diff <fixed-point>...HEAD` (three-dot, so the comparison is against the merge-base). Also note the list of commits via `git log <fixed-point>..HEAD --oneline`.

For a work-in-progress review, resolve `git merge-base <fixed-point> HEAD` and compare that resolved SHA to the working tree with `git diff <merge-base-sha>`. This includes committed, staged, and unstaged tracked changes. Inspect `git status --short` and `git ls-files --others --exclude-standard` for untracked files, and read relevant untracked files separately; they are not included in `git diff`. If it is unclear whether the user wants committed-only or WIP changes, ask before choosing. Keep the exact scope, commands, and untracked file list identical for both review axes.

Before going further, confirm the fixed point resolves (`git rev-parse --verify <fixed-point>^{commit}`) and the selected review scope is non-empty, counting relevant untracked files for WIP. A bad ref or empty scope should fail here, not inside two parallel sub-agents. Treat refs as data and quote them appropriately in shell commands.

### 2. Identify the spec source

Look for the originating spec, in this order:

1. Issue references in the commit messages (`#123`, `Closes #45`, GitLab `!67`, etc.), fetched with an available, authorized tracker tool.
2. A path the user passed as an argument.
3. Follow `docs/KMLA_SPEC_INDEX.md` to the relevant domain specification and technical design. Use `docs/AGENT_MAP.md` to map changed files to their features and specifications; do not treat sections marked unimplemented as current behavior or assume the entire future design was requested.
4. If nothing is found, ask the user where the spec is. If they say there isn't one, the **Spec** review will skip and report "no spec available".

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

### 4. Run both reviews independently

When sub-agents are available and permitted, issue both calls together, in the foreground, and aggregate the reports they return. Use read-only review agents with the briefs below. Otherwise complete each brief sequentially and retain separate reports; do not merge the axes during review.

**Standards sub-agent prompt** (or sequential review brief) should include:

- The full diff command and commit list, plus any relevant untracked file paths and contents from step 1.
- The list of standards-source files you found in step 3, **plus the smell baseline from step 3** pasted in full (the sub-agent has no other access to it).
- The brief: "Report, per file/hunk where relevant, (a) every place the diff violates a documented standard: cite the standard (file + the rule); and (b) any baseline smell you spot: name it and quote the hunk. Distinguish hard violations from judgement calls: documented-standard breaches can be hard, but baseline smells are always judgement calls, and a documented repo standard overrides the baseline. Skip anything tooling enforces. Under 400 words."

**Spec sub-agent prompt** (or sequential review brief) should include:

- The same diff command and commit list, plus the same relevant untracked file paths and contents from step 1.
- The path or fetched contents of the spec.
- The brief: "Report: (a) requirements the spec asked for that are missing or partial; (b) behaviour in the diff that wasn't asked for (scope creep); (c) requirements that look implemented but where the implementation looks wrong. Quote the spec line for each finding. Under 400 words."

If the spec is missing, skip the Spec review and note this in the final report.

### 5. Aggregate

Present the two reports under `## Standards` and `## Spec` headings, verbatim or lightly cleaned. Do **not** merge or rerank findings, because the two axes are deliberately separate (see _Why two axes_).

End with a one-line summary: total findings per axis, and the worst issue _within each axis_ (if any). Don't pick a single winner across axes: that's the reranking the separation exists to prevent.

## Why two axes

A change can pass one axis and fail the other:

- Code that follows every standard but implements the wrong thing → **Standards pass, Spec fail.**
- Code that does exactly what the issue asked but breaks the project's conventions → **Spec pass, Standards fail.**

Reporting them separately stops one axis from masking the other.
