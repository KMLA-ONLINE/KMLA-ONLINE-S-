---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing docs/functional-spec/glossary.md, or recording the rationale for a design decision.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the _active_ discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely _reading_ `docs/functional-spec/glossary.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Project file structure

This repository's glossary is `docs/functional-spec/glossary.md`. Preserve its grouped tables, specification references, and code/schema mappings. Do not create a root `GLOSSARY.md`, a `GLOSSARY-MAP.md`, or per-feature glossaries.

Start product questions at `docs/KMLA_SPEC_INDEX.md`, code-location discovery at `docs/AGENT_MAP.md`, and document placement at `docs/README.md`. Read the applicable domain specification, technical design, and feature `AGENTS.md` before changing their terminology or decisions.

Existing specifications own product requirements; `docs/structure.md` and technical designs own implementation decisions; feature `AGENTS.md` files own local invariants. Extend the existing owner. This project has no ADRs: record decision rationale as described in [DECISION-RECORDS.md](./DECISION-RECORDS.md).

Write documents only when the active mode permits edits and the user's approved scope includes them. In Plan mode, capture proposed changes in the conversation instead of writing files. Ask before implementing ambiguous or unspecified product behavior; an approved behavior change must also update its specification or design, preserving stable section identifiers.

## During the session

### Challenge against the glossary

When the user uses a term that conflicts with the existing language in `docs/functional-spec/glossary.md`, call it out immediately. "Your glossary defines 'cancellation' as X, but you seem to mean Y. Which is it?"

### Sharpen fuzzy language

When the user uses vague or overloaded terms, propose a precise canonical term. "You're saying 'account': do you mean the Customer or the User? Those are different things."

### Discuss concrete scenarios

When domain relationships are being discussed, stress-test them with specific scenarios. Invent scenarios that probe edge cases and force the user to be precise about the boundaries between concepts.

### Cross-reference with code

When the user states how something works, check whether the code agrees. If you find a contradiction, surface it: "Your code cancels entire Orders, but you just said partial cancellation is possible. Which is right?"

### Update the glossary inline

When a term is resolved and edits are permitted, update `docs/functional-spec/glossary.md` right there. Don't batch these up: capture them as they happen. Follow the project-specific format guidance in [GLOSSARY-FORMAT.md](./GLOSSARY-FORMAT.md). If edits are not permitted, record the proposed term and definition in the conversation.

The glossary contains terminology, concise definitions, references to canonical specification rules, and code/schema mappings. Preserve those existing mappings, but do not turn the glossary into a spec, scratch pad, or repository for implementation decisions. Put new requirements and design decisions in their owning documents and link them as needed.

### Record decisions sparingly

Only record a decision's rationale when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip it. When all three hold, write it as a code comment at the decision site or in the owning document, following [DECISION-RECORDS.md](./DECISION-RECORDS.md). Never create ADR files or a `docs/adr/` directory.
