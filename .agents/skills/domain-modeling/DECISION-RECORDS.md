# Decision Records

This project has no ADRs. Do not create ADR files or a `docs/adr/` directory. Record a decision's rationale where the next reader will meet it:

| Decision scope                                           | Where to record it                                 |
| -------------------------------------------------------- | -------------------------------------------------- |
| Local: one module or function would otherwise look wrong | A code comment at that code                        |
| One feature's invariant                                  | That feature's `AGENTS.md`                         |
| Cross-cutting implementation or architecture             | The owning technical design or `docs/structure.md` |
| Product behavior                                         | The owning specification (ask the user first)      |

Follow `docs/README.md` for document responsibilities. Write only when the active mode permits edits and the user's approved scope includes them; in Plan mode, propose the record in the conversation.

## Shape

One to three sentences: the context, what was decided, and why. Mention a rejected alternative only when the rejection is non-obvious, so nobody re-suggests it.

```ts
// <What was decided>: <why>. <Rejected alternative and why, only if non-obvious.>
```

The value is in recording _that_ a decision was made and _why_, not in filling out sections.

## When to record

All three of these must be true:

1. **Hard to reverse**: the cost of changing your mind later is meaningful
2. **Surprising without context**: a future reader will look at the code and wonder "why on earth did they do it this way?"
3. **The result of a real trade-off**: there were genuine alternatives and you picked one for specific reasons

If a decision is easy to reverse, skip it: you'll just reverse it. If it's not surprising, nobody will wonder why. If there was no real alternative, there's nothing to record beyond "we did the obvious thing."

### What qualifies

- **Technology choices that carry lock-in.** Database, auth provider, deployment target. Not every library: just the ones that would take a quarter to swap out.
- **Boundary and scope decisions.** Which feature owns which data; the explicit no-s are as valuable as the yes-s.
- **Deliberate deviations from the obvious path.** Anything where a reasonable reader would assume the opposite. These stop the next engineer from "fixing" something that was deliberate.
- **Constraints not visible in the code.** External limits, policy, or contracts that force the shape of the code.
- **Rejected alternatives when the rejection is non-obvious.** Otherwise someone will suggest it again in six months.
