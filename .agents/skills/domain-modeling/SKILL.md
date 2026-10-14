---
name: domain-modeling
description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing docs/functional-spec/glossary.md, or recording or editing an architectural decision.
---

# Domain Modeling

Actively build and sharpen the project's domain model as you design. This is the _active_ discipline: challenging terms, inventing edge-case scenarios, and writing the glossary and decisions down the moment they crystallise. (Merely _reading_ `docs/functional-spec/glossary.md` for vocabulary is not this skill: that's a one-line habit any skill can do. This skill is for when you're changing the model, not just consuming it.)

## Project file structure

This repository's glossary is `docs/functional-spec/glossary.md`. Preserve its grouped tables, specification references, and code/schema mappings. Do not create a root `GLOSSARY.md`, a `GLOSSARY-MAP.md`, or per-feature glossaries.

Start product questions at `docs/KMLA_SPEC_INDEX.md`, code-location discovery at `docs/AGENT_MAP.md`, and document placement at `docs/README.md`. Read the applicable domain specification, technical design, and feature `AGENTS.md` before changing their terminology or decisions.

Existing specifications own product requirements; `docs/structure.md` and technical designs own implementation decisions; feature `AGENTS.md` files own local invariants. Extend the existing owner first. Use a separate ADR only for an important decision that needs independent tracking and satisfies the criteria below. If no `docs/adr/` exists, create it only when an approved ADR is needed, and register new documents in `docs/README.md`.

Write documents only when the active mode permits edits and the user's approved scope includes them. In Plan mode, capture proposed changes in the conversation instead of writing files. Ask before implementing ambiguous or unspecified product behavior; an approved behavior change must also update its specification or design, preserving stable section identifiers.

### Generic layout examples

The upstream examples below describe other repositories, not file-creation instructions for this project. The project paths and ownership rules above take precedence.

Most repos have a single context:

```
/
├── GLOSSARY.md
├── docs/
│   └── adr/
│       ├── 0001-event-sourced-orders.md
│       └── 0002-postgres-for-write-model.md
└── src/
```

If a `GLOSSARY-MAP.md` exists at the root, the repo has multiple contexts. The map points to where each one lives:

```
/
├── GLOSSARY-MAP.md
├── docs/
│   └── adr/                          ← system-wide decisions
├── src/
│   ├── ordering/
│   │   ├── GLOSSARY.md
│   │   └── docs/adr/                 ← context-specific decisions
│   └── billing/
│       ├── GLOSSARY.md
│       └── docs/adr/
```

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

### Offer ADRs sparingly

Only offer to create an ADR when all three are true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will wonder "why did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If any of the three is missing, skip the ADR. Even when all three hold, prefer the existing owning design unless the decision needs independent tracking. Use the format in [ADR-FORMAT.md](./ADR-FORMAT.md).
