# ADR Format

## Project placement

`docs/adr/README.md` is the source of truth for ADR placement, file naming, numbering, status values, and supersession, and it lists every ADR. Read it before writing one; this file keeps the upstream criteria and examples. Where its rules differ from this file, follow it.

Extend the existing owning document first: a local reason goes in a code comment, a feature invariant in that feature's `AGENTS.md`, and the current rule in the owning specification or technical design. Create an ADR only for a cross-cutting decision that meets the criteria below, when the user approves recording it and the active mode permits edits. In Plan mode, propose it in the conversation instead.

ADRs live in `docs/adr/` as `NNNN-english-kebab-slug.md`. Scan `docs/adr/` for the highest existing number and increment by one, then add the ADR to the list in `docs/adr/README.md`. Write ADRs in Korean.

## Template

```md
# {결정의 짧은 제목}

**상태**: 채택 · **날짜**: YYYY-MM-DD

{맥락, 결정, 이유를 1~3문장으로.}
```

That's it. An ADR can be a single paragraph. The value is in recording _that_ a decision was made and _why_, not in filling out sections.

## Optional sections

Only include these when they add genuine value. Most ADRs won't need them.

- **검토한 대안** (Considered Options): only when the rejected alternatives are worth remembering
- **영향** (Consequences): only when non-obvious downstream effects need to be called out

The status line uses `제안 | 채택 | 폐기 | ADR-NNNN으로 대체`. Do not rewrite an accepted ADR: when the decision changes, write a new ADR and update only the old one's status line.

## When to offer an ADR

All three of these must be true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it: you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Architectural shape.** "We're using a monorepo." "The write model is event-sourced, the read model is projected into Postgres."
- **Integration patterns between contexts.** "Ordering and Billing communicate via domain events, not synchronous HTTP."
- **Technology choices that carry lock-in.** Database, message bus, auth provider, deployment target. Not every library: just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** "Customer data is owned by the Customer context; other contexts reference it by ID only." The explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** "We're using manual SQL instead of an ORM because X." Anything where a reasonable reader would assume the opposite. These stop the next engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** "We can't use AWS because of compliance requirements." "Response times must be under 200ms because of the partner API contract."
- **Rejected alternatives when the rejection is non-obvious.** If you considered GraphQL and picked REST for subtle reasons, record it; otherwise someone will suggest GraphQL again in six months.
