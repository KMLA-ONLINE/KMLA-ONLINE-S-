# Design It Twice

When the user wants to explore alternative interfaces for a chosen deepening candidate, use this comparison pattern. Based on "Design It Twice" (Ousterhout): your first idea is unlikely to be the best. Use parallel sub-agents when available and permitted by the host's instructions; otherwise produce the same alternatives sequentially yourself. Do not require another tool or package to run this process.

Uses the vocabulary in [SKILL.md](SKILL.md): **module**, **interface**, **seam**, **adapter**, **leverage**.

## Process

### 1. Frame the problem space

Before designing alternatives, write a user-facing explanation of the problem space for the chosen candidate:

- The constraints any new interface would need to satisfy
- The dependencies it would rely on, and which category they fall into (see [DEEPENING.md](DEEPENING.md))
- A rough illustrative code sketch to ground the constraints, not a proposal, just a way to make the constraints concrete

Show this to the user, then immediately proceed to Step 2. When using sub-agents, the user reads and thinks while they work in parallel.

### 2. Produce alternative designs

Produce 3+ **radically different** interfaces for the deepened module. If using sub-agents, spawn 3+ in parallel and assign one alternative to each. Otherwise work through the same briefs sequentially; do not merely rename a single design.

Prepare a separate technical brief for each alternative (file paths, coupling details, dependency category from [DEEPENING.md](DEEPENING.md), what sits behind the seam). The brief is independent of the user-facing problem-space explanation in Step 1. Give each alternative a different design constraint:

- Design 1: "Minimize the interface: aim for 1–3 entry points max. Maximise leverage per entry point."
- Design 2: "Maximise flexibility: support many use cases and extension."
- Design 3: "Optimise for the most common caller: make the default case trivial."
- Design 4 (if applicable): "Design around ports & adapters for cross-seam dependencies."

Use the applicable project instructions already loaded in the current context to identify any designated project glossary. Do not require rereading agent instruction files such as `AGENTS.md` or `CLAUDE.md` just to discover that path. Read the designated glossary regardless of its filename or location; only when no glossary is designated, check for `GLOSSARY.md` at the project root. If a designated path is ambiguous or the file is missing, report that rather than silently substituting another file.

Include both [SKILL.md](SKILL.md) vocabulary and the project glossary vocabulary, if available, in the brief so each alternative names things consistently with the architecture language and the project's domain language.

Each alternative outputs:

1. Interface (types, methods, params, plus invariants, ordering, error modes)
2. Usage example showing how callers use it
3. What the implementation hides behind the seam
4. Dependency strategy and adapters (see [DEEPENING.md](DEEPENING.md))
5. Trade-offs: where leverage is high, where it's thin

### 3. Present and compare

Present designs sequentially so the user can absorb each one, then compare them in prose. Contrast by **depth** (leverage at the interface), **locality** (where change concentrates), and **seam placement**.

After comparing, give your own recommendation: which design you think is strongest and why. If elements from different designs would combine well, propose a hybrid. Be opinionated: the user wants a strong read, not a menu.
