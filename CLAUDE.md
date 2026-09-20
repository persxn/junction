# Competition Intel — worker rules
Repo: C:\Users\Calamity\Desktop\competition-intel · Windows
You are the implementation engineer. Architecture decisions come from the architect via the user.

## Every session starts fresh
1. Read docs/PROGRESS.md first.
2. Read ONLY the files and spec sections your WP prompt lists. Find sections by searching
   docs/ARCHITECTURE.md for headings (^## / ^### ) and read just those line ranges.
3. Don't open docs/handoff/* or docs/research/* unless the prompt says so.

## Rules
- Stay inside the WP scope. If the spec is silent, choose the smallest reasonable option and record
  it under "Minor decisions". If it's architectural, stop and ask under "Questions for the architect".
- Never contradict docs/adr/* silently.
- Every new dependency: name@version + reason in the report.
- Business logic stays out of UI components; files < 400 lines; strict typing; tests with every change.
- Never contact event websites beyond what the WP explicitly allows.
- Dev data (SQLite DB, logs, models) lives in %LOCALAPPDATA%\CompIntel-dev, never inside the repo.

## Reports & handoffs
- Handoffs are **plain `.md` files under `docs/`** (`docs/handoff/WP-xx.md`) plus the report printed in the
  reply. Never publish web pages, artifacts or hosted documents for them — no HTML, no external services.

## Finishing a WP
1. `pnpm verify` passes (from WP-03 on).
2. Update docs/PROGRESS.md: ≤ 10 lines for this WP; summarize older entries to keep the file < 150 lines.
3. Save the report to docs/handoff/WP-xx.md and commit "WP-xx: <summary>".
4. Print the report below. Keep it under 80 lines and don't paste whole files.

=== WORKER REPORT: WP-xx ===
Status: DONE | PARTIAL | BLOCKED
Summary (≤5 lines):
Files changed (paths only):
Tests/commands & results:
Deviations from the prompt (why):
Minor decisions made:
New dependencies (name@version — why):
Known issues / tech debt:
Questions for the architect:
Files the architect should review (≤5, most important first):
Suggested next step:
===
