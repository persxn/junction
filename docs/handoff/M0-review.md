# M0 review — architect's return

Reviewer: architect (Claude, Cowork session) · Date: 2026-09-20 · Scope: `docs/handoff/M0.md` in full —
the 44 self-issued rulings, the engineering decisions, the owner's decisions, and the open-question table.
Spec is edited alongside this review (now v1.1.6); this file is the account of *why*.

**Bottom line: M0 is accepted as shipped. No code changes requested.** 14/48 WPs done, `pnpm verify`
green (1736 tests), the built exe was clicked through end to end. Everything below is documentation —
closing questions, folding rulings into ADRs, and fixing drift between files that should have agreed
and didn't.

---

## 1. Rulings R1–R44 — reviewed, accepted as written

Read every row of §21 R1–R44 against the ADRs and the handoffs that produced them. All 44 stand
unchanged. None contradicts an ADR, a resolved decision, or an earlier ruling. Two housekeeping notes
that came out of the pass:

- **R39's exempt-route list was stale.** PROGRESS.md's WP-07b entry already said `/system/shutdown` is
  exempt from the setup gate (so the tray can exit from inside the wizard), but the R39 row in §21 only
  listed `/health`, `/setup/*` and `/system/client-log`. That's a doc bug, not a behavior bug — the
  shipped code and the handoff agree with each other, only the ruling text had fallen behind. Fixed in
  place (v1.1.6).
- **Two of the four "waiting on you" table's older siblings were already answered.** WP-05b's Q2 (LNA
  timeout) and Q4 (autostart per-user) — carried in `M0.md`'s own §4 table as if still open — are both
  already settled by later rulings: R27 dropped the direct-fetch timeout to 2 s, and R28 says autostart
  stays per-Windows-user, out of scope for per-machine. See §3 below; this is why the table in this file
  has 8 rows instead of M0.md's 10.

No ADR needed a rewrite; two needed amendments (next section).

## 2. ADR amendments

**ADR-0010 (auth)** and **ADR-0011 (backups)** were flagged in M0.md §3.1 as extended by rulings without
being amended. Both are now amended (v1.1.6) to state R33/R34/R37/R38 and R41/R42 as decisions, not just
cross-references — a future reader of the ADR alone now gets the actual session/lockout/auto-lock/
recovery design, not just a pointer into §21. No substantive change: this is transcription, and both
ADRs say so explicitly in their own amendment sections.

One thing worth being explicit about, since it wasn't spelled out anywhere before: **the admin recovery
code (ADR-0010/R41) and the backup passphrase (ADR-0011/R41) must stay two different secrets.** The code
recovers *account access*; the passphrase recovers *data*. If they were the same secret, writing it into
the recovery file (which the wizard forces before Finish) would also hand a reader the code — and the
recovery file's entire point is that it contains no secret capable of impersonating an admin. This
already held in the shipped R41/R42 design; ADR-0011's new amendment section names it as a constraint
so it isn't accidentally merged later.

## 3. Decisions

### 3.1 Q1 — does §3.1 still hold?

**Resolved.** The owner's "standalone app, one professor, one machine, his own students" is now the
answer to Q1, not a tension with it. §3.1 is amended: host mode is the pilot's only mode (client mode is
demoted from "post-MVP, when Q1 requires it" to "speculative, not scheduled" — nothing currently commits
to ever building it), and the sentence that justified accounts is reframed rather than deleted.

Why not strip accounts/RBAC/lockout/audit for a single-user product? Three reasons, all already implicit
in what the owner actually said:

1. **The owner was asked directly** whether to drop or dial down Argon2id, the lockout ladder, the audit
   chain, the unused recovery code and auto-lock, and **said no, proceed as specified.** Re-litigating
   that under a different heading (§3.1 instead of §3.3.2) would be ignoring an answer already given.
2. **It's already built and tested** (WP-07a/07b, 1736 tests). Removing it is negative-value engineering
   work whose only benefit is a simpler mental model of a system that already works.
3. **"One professor" is the pilot, not a permanent ceiling.** An admin account distinct from the
   professor account is a real feature even in the single-user case (it's how "sign in as
   administrator to manage users/settings" vs. "sign in as professor to do the job" stays separable),
   and a co-professor or TA is a one-`POST /admin/users`-call addition, not a redesign, precisely
   because the multi-account model was kept.

Nothing about this decision touches client mode, which really is unbuilt and unscheduled — that part of
§3.1 is genuinely narrowed, not just reframed.

### 3.2 New rulings

| Ruling | Question it closes | Answer |
|---|---|---|
| R45 | M0.md §4, row 4 — who owns "sign in with the recovery code"? | **WP-30.** It's an admin-recovery tool, not core auth: every WP before WP-30 can always reach an admin through normal login, so there's no urgency, and WP-30 already owns the health/audit surface it belongs next to. |
| R46 | M0.md §4, row 2 — should the wizard calibrate Argon2id per host? | **No, not yet — and don't build calibration speculatively.** Fixed parameters stand. WP-31 re-measures on the real pilot host (or the 8 GB reference machine once one exists) before the pilot; calibration is added only if that measurement is materially worse than the 322–409 ms seen here. Building a calibration path now, before there's a second data point, is guessing at a problem that may not exist. |
| R47 | M0.md §4, row 3 — should `/system/shutdown` require a session? | **No — this was already correct, just underdocumented.** §10.3 is corrected to list it as exempt, alongside `/health`/`/auth/login`/`/setup/*`. Requiring a session would break "Exit completely" from the lock screen, which is a real, expected action (a locked machine should still let you quit the app), and the client secret already scopes the endpoint to the local shell process. |

### 3.3 Questions answered without a new ruling

- **M0.md §4, row 5 — is UUIDv7 + single writer enough audit ordering, or add a sequence column?**
  No sequence column. The backend is single-process per data directory (R15's lock enforces this), audit
  rows are written inside the same transaction as the change they record, and UUIDv7 embeds
  millisecond-resolution time plus randomness in a way that sorts correctly even across a clock step
  back (the spec's own A16 already required monotonicity for exactly this reason). A sequence column
  would be redundant insurance against a failure mode (concurrent writers) that R15 already rules out
  by construction.
- **M0.md §4, row 6 — job observability now or with WP-30?** Confirms R20/R22 as already decided:
  deferred to WP-30, no code change now.
- **M0.md §4, row 9 — should the backup folder also refuse a repo folder or an absent removable
  drive?** No. R43's checks (exists, writable by write-probe, not inside the data directory, ≥ 1 GB
  free) already catch the failure modes that matter for a solo pilot. Detecting "this looks like a git
  repo" or "this drive letter might be a USB stick that could be unplugged" adds real complexity
  (directory-walking for `.git`, drive-type queries) for a benefit that doesn't clear the bar the rest
  of M0 held to — R43 didn't over-build for the single-machine case, and this shouldn't either.
- **M0.md §4, row 10 — which WP owns the density switch?** No WP, for now. It's UI polish, not a
  correctness or trust question, and every roadmap WP that touches the Discover UI (WP-16a onward) can
  add it as a small extension of `settings.ts` (already the one typed registry, R40) whenever list
  density actually becomes a complaint. Assigning it a WP number now would be scope invented ahead of
  evidence it's needed.

## 4. Decisions register / spec drift

Found while cross-checking DECISIONS.md against PROGRESS.md and ARCHITECTURE.md §2/§2.1: **U1 and U2
said OPEN in DECISIONS.md** (and, it turned out, in ARCHITECTURE.md's own §2.1 copy of the same table)
**although WP-03a closed both** and PROGRESS.md has said so since that WP. Likewise ARCHITECTURE.md §2's
Q3 row hadn't been marked CLOSED even though DECISIONS.md's copy already was. All three files now agree:
U1/U2 DONE, Q3 CLOSED, Q1 RESOLVED (§3.1 above).

This is a process note, not a scope note: **DECISIONS.md and ARCHITECTURE.md §2/§2.1 are two copies of
the same table, and the review that closes an item in one must close it in the other in the same commit.**
Nothing caught this until a full-file cross-read; a smaller diff-only review wouldn't have. Worth keeping
in mind for future rulings passes.

## 5. Style instruction, applied here

Per the owner's instruction (M0.md §3.3.3), this review describes what the code and rulings do rather
than what attack they prevent, wherever that didn't require rewriting an existing ADR's own words.
Existing comments and ADR text were left alone per the same instruction (applies "from here on", not
retroactively).

## 6. Released — all of M1, plus a consolidation WP and a new milestone

`docs/prompts/` is now organized by milestone (`M0/`, `M1/`, `M4/`), with an index at
`docs/prompts/README.md`. Released in this pass:

1. **`prompts/M1/pre-M1.md`** — a consolidation refactor that runs **before** WP-08a. It changes no
   behaviour. It exists because five things that are fine for M0's four backend modules are wrong for
   M1's thirteen: date handling invented per adapter, layer boundaries enforced by convention rather than
   by the linter, the audit hash chain hand-rolled per use case, one settings file every module edits,
   and no golden-fixture harness for the five adapters M1 adds. A day now, a week spread across M1.
2. **`prompts/M1/WP-08a … WP-16b`** — the whole events milestone, thirteen prompts, released up front so
   the worker sessions don't queue behind a review round each time. (The roadmap's M1 is thirteen WPs,
   not nine — the letter-suffixed splits from the WP-01 review add up.) Each is self-sufficient; the
   prompts for WP-08a…WP-10 carry STEP 0 rulings blocks that claim §21 rows **R48–R66** and spec
   versions 1.1.7–1.1.11, which is why those numbers are marked reserved in §21 now.
3. **`prompts/M4/WP-33.md`** and a new milestone **M4.5 — Delight**, between M4 and M5: the appearance
   system (Catppuccin palette layer under the existing semantic tokens, CALM/STANDARD/SHOWCASE effect
   tiers, motion and glow, RGB presets) and the **Insights** surface. Recorded in **ADR-0019** with
   rulings **R67–R69**, and §16.3 extended.

On WP-33 specifically: the owner asked for glows, gradients, animations, RGB presets and a rewarding,
"addicting" feel. Four things in the spec pulled against parts of that — the measured contrast test from
WP-06 (Catppuccin accents don't all clear 4.5:1 as text on their own base), §16.3's no-decorative-loops
and never-colour-alone rules, WP-32's 72-hour tray soak (a permanently animating gradient is a cost paid
while nobody is watching), and D-11's no-fabrication line. None of those is an objection to visual
richness, only to specific mechanisms, so ADR-0019 keeps the richness and changes the mechanisms: a
palette layer *beneath* the token contract rather than a token rewrite; effects in tiers with CALM as a
real state that reduced-motion forces and that loses no information; animation that stops when the
window is hidden; and an Insights surface whose every number is a deterministic read model over rows
that already exist — participation, funnel conversion, outcomes, mentor load, deadline-hit rate, source
contribution, streaks — with milestone celebrations tied to recorded outcomes and no streak-pressure
mechanics. If an effect can't hold 60 fps or idle at ~0 % CPU in the tray, WP-33 cuts it rather than
WP-32 discovering it.

Nothing in M0 blocks any of this.
