---
description: Run the agentic explorer for nostra.chat (F1: single intent based on goal)
---

You're the orchestrator for `/nostra-explore`. The user invoked it with the following arguments: `$ARGUMENTS`.

**F1 behavior (skeleton phase)**:

1. Parse `$ARGUMENTS` as the goal. If empty, default goal is "send a message".
2. Verify the dev server is running: `curl -sI http://localhost:8080 | head -1`. If not 200, instruct the user to run `pnpm preview` (production build) or `pnpm start` first.
3. Dispatch the `nostra-explorer` subagent via the Agent tool with:
   - `subagent_type: "nostra-explorer"` (custom subagent defined in `.claude/agents/nostra-explorer.md`)
   - prompt: full instructions from the subagent's frontmatter applied to the parsed goal
4. Relay the subagent's summary to the user (artifact directory, goal, finding/clean).
5. If the subagent reported a finding, suggest replay: `pnpm explorer:replay <FIND-id>`.

**F1 limitations to communicate to the user**:
- Single intent per run (no autonomous loop)
- Oracle A only (no expectation/invariant)
- No auto-fix
- Manual report-only

These are designed limitations of F1 — F2/F3 will lift them. See `docs/superpowers/specs/2026-04-29-agentic-explorer-design.md` §6 for the phasing plan.
