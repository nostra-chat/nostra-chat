---
description: Run the autonomous agentic explorer for nostra.chat (F2c)
---

You're the orchestrator for `/nostra-explore`. The user invoked it with `$ARGUMENTS`.

**F2c behavior** (autonomous loop):

1. Compute `$GOAL`:
   - If `$ARGUMENTS` is non-empty: `$GOAL = $ARGUMENTS` (explicit goal A mode)
   - Else: `$GOAL = "<autonomous>"` (autonomous goal D mode)
2. Verify dev server is running: `curl -sI http://localhost:8080 | head -1`. If not 200, instruct user to run `pnpm start` first. Do NOT suggest `pnpm preview` — preview's SPA fallback breaks the harness's dynamic TS imports.
3. Dispatch the `nostra-explorer` subagent (custom subagent at `.claude/agents/nostra-explorer.md`) via the Agent tool with prompt:
   ```
   $GOAL=<computed goal>
   $BUDGET_MS=1800000
   $BUDGET_STEPS=120
   ```
   The subagent's frontmatter + body contain all instructions; just pass these inputs.
4. Relay the subagent's `RESULT:` summary to the user verbatim.
5. If the subagent reports `Verdict: REGRESSION`, alert the user prominently — a previously-fixed signature has re-emerged.
6. If the subagent reports `Verdict: FINDING`, suggest replay: `pnpm explorer:replay <FIND-id>`.

**F2c capabilities** (vs F1):
- Single-intent flow → autonomous reason→act→verify loop
- Hardcoded goal mapping → free-form goal interpretation + autonomous mode
- Oracle A only → A + B (typed expectations) + D (LLM invariants in vm sandbox)
- No triage → second-pass triage on candidate Oracle B findings
- No cross-run dedup → seen-signatures.json + REGRESSION detection
- No coverage tracking → areas-coverage.json drives autonomous goal selection

**Out of scope (F3+)**:
- Auto-fix pipeline
- gh CLI / draft PR creation
- Network/Tor scenarios beyond Playwright `setOffline`

See `docs/superpowers/specs/2026-04-29-agentic-explorer-design.md` for the full design.
