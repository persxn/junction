# M1 review — architect

Reviewer: architect · Date: 2026-09-22 · Spec after this review: **v1.1.14** · Scope: every M1 handoff
(pre-M1 … WP-16b), their questions, and the UI they shipped.

**Bottom line: M1 is accepted.** 14 WPs, 3111 tests, `pnpm e2e` green, "Sources disagree" visible on the
conflict fixture. WP-15b's one miss (p95 52.4 ms vs 50) is fixed by R88 in pre-M2b. Three live smokes are
still owed because no `scraper.contactEmail` is set on the dev database — pre-M2b runs them if it is.

---

## 1. R74 — signed-in reading (owner ruling): stands, with two constraints

R74 is careful work and the owner's call. Two things it did not cover, now ruled:

- **R75 — the network, not just the account.** Unstop's Terms let it cancel an account **and block every
  user behind that IP address**. On a campus network many students share one public address, so an IP
  block reaches people who never accepted the risk. Scheduled listing walks therefore stay anonymous;
  the session is used only for the professor's own pages and for detail pages the public site does not
  fill, at ≤ 5 requests per run, ≥ 10 s apart. The owner can widen this — it is written down so that
  widening is a decision.
- **R76 — the cookie is live account access.** R74 stored it "like an API key", and §6.2 calls API keys
  low-value. A session is not: it can register, edit a profile, submit. It is now sealed under a
  shell-held, DPAPI-protected key, so a copy of the database — or a backup restored elsewhere — carries
  nothing usable.

R70's reasoning ("the app never authenticates") is marked partly superseded rather than rewritten.

## 2. Questions from the M1 handoffs

| From | Question | Ruling |
|---|---|---|
| WP-08b Q1 | Gazetteer is 68.5 MB, 95 % unpopulated hamlets | **R82** — population > 0 or admin seat; ~7 600 rows |
| WP-08b Q2 | INSTITUTION rung unreachable | Accept CITY for now; curation moves to WP-29 (R82) |
| WP-09a Q1 | Is one 403 terminal? | No; **three** consecutive BLOCKED runs are (**R79**) |
| WP-09a Q2 | `scrape_runs.kind`? | Yes — pre-M2b |
| WP-09a Q3 | CTFtime cadence 30 vs 60 | Keep 30 (D-27); with `detailPolicy: never` a run is one request |
| WP-09a Q4 | Devpost `trust_rank` 60 | Confirmed (manual-only, so it only ranks typed entries) |
| WP-09a Q5 | Who re-enables a paused source | An admin; WP-23 notifies (Q4) |
| WP-09b Q1 | End anchor on allowed paths | Yes, trailing `$` — pre-M2b |
| WP-09b Q2 | CTFtime detail fetches | `detailPolicy: 'never'` — pre-M2b |
| WP-09b Q3 | CTFtime event with no dates | Invalid (**R85**) |
| WP-09b Q4, WP-11 Q2 | Offset precision | Fix the library; offsets are exact (**R85**) |
| WP-10 Q1 | Field-group resolution | Confirmed (**R84**) |
| WP-10 Q2 | Audit re-scrapes? | No — `event_changes` is their history (**R84**) |
| WP-10 Q3 | Unmerge → REJECTED | Confirmed (**R84**) |
| WP-11 Q1 | CLIST robots exemption | Accepted (**R77**); owner re-signs when U4's key exists |
| WP-11 Q3 | 401 on keyed sources | Global credential state, never BLOCKED (**R80**) |
| WP-12 Q2 | Which address in the UA | The professor's own (R74) |
| WP-12 Q3 | WP-04a harness timeout change | Accepted |
| WP-13 Q2 | `mailto:` rendering | Address text only — pre-M2a |
| WP-13 Q3 | Replace synthetic fixtures | In place, goldens regenerated, diff reviewed — pre-M2b |
| WP-14 Q1 | "Connect your sources" step | Yes, right after the wizard, outside R40 — pre-M2a |
| WP-14 Q2 | `url-import` enabled | Confirmed |
| WP-14 Q3 | `.invalid` URL on screen | Never rendered; "Entered by hand" — pre-M2a |
| WP-14 Q4 | Commit trusts edited fields | Diff against the cached preview — pre-M2b |
| WP-15a Q1 | Who writes `event_tags` | The linker, from source tags (**R87**) |
| WP-15a Q2 | User-state tables moved to 15a | Confirmed |
| WP-15a Q3 | STATE/COUNTRY precision for distance | Unknown location (**R81**) |
| WP-15b Q1 | Perf miss | Denormalize trust + budget the default feed (**R88**) |
| WP-15b Q2 | `SORT_KEY` reason | Confirmed |
| WP-15b Q3 | Tag tables created in 15b | Confirmed |
| WP-16a Q1 | Contest Calendar filter | `EventQuery.recurringOnly` — pre-M2b |
| WP-16a Q2 | Non-GET through the proxy | Yes (**R78**) — pre-M2a |
| WP-16a Q3 | `watchlisted` on the card | Confirmed |
| WP-16b Q1 | Is prize material? | No — R63 forbids conversion, so it would be a permanent conflict (**R83**) |
| WP-16b Q2 | `open_external` | Now, not WP-30 (**R78**) — pre-M2a |
| WP-16b Q3 | Publish scrape events | Yes (**R86**) — pre-M2a |

## 3. UI faults found in M1 (owner's instruction: look for them)

All from the handoffs' own "Known issues"; all fixed in **pre-M2a** unless noted.

1. **Every write fails under the F9 fallback** — Save, Hide, category override, POST search. The most
   serious: invisible on this machine, total on an LNA-enforcing one. (R78)
2. **"Open registration" may do nothing** in the packaged app — `window.open` is refused. (R78)
3. **Sign-in needs two buttons** because the window cannot report back.
4. **Freshness can lie by up to 60 s** and nothing publishes scrape events. (R86)
5. **The rail brand sits outside every landmark**, and the axe tests were scoped to hide it.
6. **A manual event shows a fake `.invalid` URL** in the provenance drawer.
7. **Scraped `mailto:` links render as clickable links.**
8. **A 649 kB bundle chunk.**
9. **`pnpm verify` at 124 s**, with 45 s per-test timeouts creeping in. (R89)
10. **Tags filter and tag-interest boost are inert** (pre-M2b, R87) and **distance from a state centroid
    looks exact** (pre-M2b, R81).

Every M2 and M3 prompt now ends with a standing **UI fault sweep** of the screens it touches and links to.

## 4. Open questions decided for M2/M3

- **Q4** (WP-23) — resolved: recipients and thresholds as the long-standing default, plus admin notices for
  R79/R80 and backups; each fires once per dedupe key.
- **Q6** (WP-17/18) — external students in the model, UI behind `students.allowExternal`, off.
- **Q7** (WP-21) — the default outcome fields; amounts never converted.
- **Q8** (WP-17) — minimal fields, phone off, privacy-notice date; the owner checks the university's
  data-protection policy before real student data lands (D-33).
- **R90** — the tray gets two badges with two owners: WP-23's unread count, WP-30's health. The §19 row
  for WP-23 always said "tray badge"; R29 had said the tray stays static — now reconciled.

## 5. Released

`docs/prompts/M2/` — **pre-M2a**, **pre-M2b**, WP-17, 18, 19, 20a, 20b, 21 · `docs/prompts/M3/` — WP-22, 23, 24.
Rulings R91–R113 are reserved for their STEP 0 blocks (spec 1.1.15–1.1.23). Roadmap: **50 WPs, 28 done,
22 remaining.** Send `docs/` back when M3 closes.
