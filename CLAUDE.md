# CLAUDE.md — Working rules for competition-intel

Product/architecture decisions come from the architect (via the user). The implementation
engineer executes work packages (WPs). Reference spec: `docs/requirements/master-requirements.md`.

## Rules

- Work only within the current work package (WP) scope.
- Architecture decisions live in `docs/adr`; never contradict them silently.
  If you disagree, raise it under "Questions for the architect".
- Every WP ends with: tests passing, a commit `WP-xx: <summary>`, and a report
  saved to `docs/handoff/WP-xx.md` AND printed in chat (format below).
- No new dependency without listing it + justification in the report.
- Keep business logic out of UI components; prefer files < 400 lines.
- Never fetch event websites beyond what a WP explicitly specifies.

## Report format

```
=== WORKER REPORT: WP-xx ===
Status: DONE | PARTIAL | BLOCKED
Summary (≤5 lines):
Files changed:
Tests/commands run & results:
Deviations from the prompt (and why):
Minor decisions I made:
New dependencies:
Known issues / risks noticed:
Questions for the architect:
Suggested next step:
===
```

## Layout

- `docs/requirements/` — master requirements (reference only)
- `docs/adr/` — architecture decision records
- `docs/handoff/` — per-WP worker reports
- `docs/research/` — recon notes, saved robots.txt files
