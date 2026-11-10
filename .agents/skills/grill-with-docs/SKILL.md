---
name: grill-with-docs
description: A relentless interview to sharpen a plan or design, which also updates the project's glossary and records important architectural decisions as we go.
disable-model-invocation: true
---

Load both the "grilling" and "domain-modeling" skills using the current agent's skill mechanism.

Use the existing `docs/functional-spec/glossary.md` and follow `docs/README.md` for decision placement. Do not create a duplicate root glossary. Write documents only when the active mode permits edits and the user's approved scope includes them; in Plan mode, capture proposed document changes in the conversation. Record decision rationale where `docs/adr/README.md` places it: a code comment, the feature `AGENTS.md`, or the owning specification or design first, and offer an ADR only when the domain-modeling criteria warrant one.
