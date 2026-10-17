# Work briefs

> **Historical records.** Each brief records what its work package was asked to build when it was dispatched. The
> code, the spec and the plan are current; a brief is not updated after its package merges, so where they differ, the
> code, spec and plan win.

One brief per work package (WP) of `docs/superpowers/plans/2026-10-14-flight-price-optimiser-plan.md`. A brief is the only document an implementer needs besides the spec and the plan: it carries that package's bite-sized tasks in the `superpowers:writing-plans` format, with real test code and real implementation code in every step.

Briefs are reviewed with `/review-spec docs/briefs/<file> --roster core` before dispatch. Critical and High findings are fixed in the brief first.

## File name and frontmatter

`docs/briefs/wpNN-<slug>.md` (WP4b is `wp04b-…`). Frontmatter:

```yaml
---
wp: 5
title: SearchApi adapter
owner: opus            # opus | sonnet | fable
depends_on: [4, 4b]
spec_sections: ["§2", "§5.2", "§5.4", "§9 item 2"]
reviewers: [code-architect, test-strategy-reviewer, provider-integration-expert, provenance-auditor, cost-and-budget-reviewer]
status: draft          # draft | reviewed | dispatched | merged
---
```

## Sections, in order

1. **Goal** — one sentence.
2. **Scope** — "In" and "Out" bullet lists. Out names the neighbouring package that owns each excluded thing.
3. **Spec sections** — the sections this brief implements, each with one line on what it requires.
4. **Interfaces consumed** — exact signatures copied from the plan's "Cross-package contracts" (never paraphrased).
5. **Interfaces produced** — exact signatures; later packages rely on these names.
6. **Library notes** — for every library the tasks use: version (from the plan's Task 0.1 list), the exact API calls used, and the documentation page verified on the date of writing. Verify with context7 (`resolve-library-id` → `query-docs`) or the official docs; never from memory.
7. **Files** — create / modify / test, exact paths.
8. **Tasks** — `### Task N.M: <name>` in the writing-plans structure: Files, Interfaces (consumes/produces), then steps `Write the failing test` (full code) → `Run to verify it fails` (command + expected text) → `Implement` (full code) → `Run to verify it passes` → `Commit` (message `wpNN: <what>`). Each task ends with an independently testable deliverable. Fold scaffolding into the task that needs it.
9. **Pinned review-focus tests** — the plan's Review Focus lines this package owns, each with its test in a task.
10. **Definition of done** — runnable commands and the exact expected outcome (`pnpm --filter @gmt/<pkg> test` with thresholds, `pnpm lint`, `pnpm -r typecheck`, `node scripts/check-boundaries.mjs`, plus package-specific commands).
11. **Open questions** — empty, or items marked `requires_human_judgment` for the operator. A brief with an open design question is not dispatchable.

## Rules every brief follows

- **The spec wins.** Where brief, plan and spec disagree, the spec is right and the others are bugs; report the mismatch, do not paper over it.
- **No placeholders.** No "TBD", "TODO", "implement later", "add error handling", "similar to Task N", "write tests for the above". Every code step shows the code. Every referenced type or function is defined in the plan's contracts, in an earlier task of this brief, or in a merged package.
- **TDD, bite-sized.** One failing test, run, minimal code, run, commit. Property tests with `fast-check` where the spec says "property".
- **Global constraints** of the plan apply to every task: package graph, no airports in code, no fabricated data, provenance on every price, money units, timestamp form, budget before fetch, secret handling, banned words, coverage thresholds.
- **Worked example only.** Tests and docs that need a route use London → New York: `LHR`, `LGW` → `JFK`, `EWR` (metro `LON`, `NYC`). No other real route. Any other IATA codes in tests are the worked example's or clearly synthetic (`AAA`, `BBB`).
- **Secrets in tests are sentinels** such as `test-searchapi-key-0123456789abcdef`; the sentinel test asserts they never reach a sink.
- **TypeScript strict** with the plan's `tsconfig.base.json`; relative imports carry `.js`; `import type` for types; no `any`; no non-null assertions.
- **Comments are generous.** Every exported symbol has a doc comment naming its spec section; non-obvious decisions carry a `// why:` line.
- **Commands are real.** Every "Run" step gives the exact command and the exact expected outcome.
