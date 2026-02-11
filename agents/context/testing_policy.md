# Testing Policy (MVP)

## Purpose
Define minimal proof standards during MVP without enforcing CI gates.

## Policy
- CI gates are intentionally disabled for the current MVP phase.
- Local verification is still required for each implementation task.
- Task owners must run all available relevant tests and lint checks listed in task `verify`.
- Any skipped verification must be documented in task scratchpad with:
  - skipped command
  - blocking reason
  - impact/risk note

## Required Evidence in Task Closeout
- Commands executed
- Result summary (pass/fail)
- Explicit skipped checks (if any)
- Residual risks and follow-up test needs
