WP-08b — Gazetteer build, institutions seed, offline geocoder, straight-line distance, and the geography + event-type policies

Fresh session. Read ONLY: docs/PROGRESS.md · docs/handoff/WP-08a.md · docs/ARCHITECTURE.md §4.17,
§6.2 ("Places" and the `events` Format & place / State column groups), §6.4 (distance row), §7.3
(the geography-relevant bullets), §7.4, §8.1 (A6 distance semantics), §8.2 (the first bullet), §3.2
(A20 packaged layout), §3.3, §21 (**R-rows and A-rows bind and beat section text**) ·
docs/adr/ADR-0012-geography-offline-gazetteer.md · docs/DECISIONS.md (D-06, D-09, D-16, D-31, **Q12**) ·
packages/contracts/src/{index,enums,errors,events,event-candidate}.ts ·
apps/backend/src/platform/{db,paths,settings,audit,time}.ts · apps/backend/src/domain/** ·
apps/backend/src/db/schema/*.ts · apps/desktop/src-tauri/src/paths.rs.

STEP 0 — Record the architect's rulings (docs only, first commit "docs: rulings v1.1.8"):
a) Version line → "**Version:** 1.1.8"; changelog row
   "| 1.1.8 | 20 Sep 2026 | Rulings R53–R57: gazetteer, geocoding, distance, policy visibility (see §21). |"
   Use the next free version and R numbers if 1.1.8 / R53 are taken.
b) Append to the §21 table:
| R53 Gazetteer is a build output | `gazetteer.db` is built on demand from GeoNames (`IN.zip` filtered to feature class P, plus `cities15000.zip` for the rest of the world) by `tools/gazetteer/build.ts` (`pnpm gazetteer:build`). Sources download to `%LOCALAPPDATA%\CompIntel-dev\gazetteer-src`, never into the repo. The built file is **not committed** — anything over 2 MB never is — and is gitignored; `resources/gazetteer/manifest.json` (source URLs, fetch date, filter rules, row counts, sha256, schema version) and `ATTRIBUTION.md` (CC BY 4.0, shown in About) **are** committed, so the build is reproducible from git alone. §3.4's "resources/ holds the build script" is superseded: `tools/` holds scripts, `resources/` holds shipped artifacts. | §4.17, §3.4, ADR-0012 |
| R54 Tests never need the real gazetteer | `pnpm verify` runs on a clean clone with no network and no `gazetteer.db`. Tests use `test/fixtures/gazetteer/mini.db` (≤ 200 KB, built by the same script with `--mini` from committed trimmed TSV samples, both committed). At runtime a missing or unreadable gazetteer is not fatal: one warning at startup, `GEO_GAZETTEER_UNAVAILABLE`, and the geocoder returns `UNKNOWN` precision. | §4.15, §4.17 |
| R55 Geocoding is lookup and matching only | Source coordinates → institution match → city + state → city → country → unknown, setting `events.geo_precision` at each step. No network call, ever — Nominatim (§4.17) stays unbuilt and off. An ambiguous city resolves to the highest-population match **within the already-resolved state or country**; still ambiguous → the precision drops to STATE or COUNTRY with a warning, never a guess across countries. A seed row whose coordinates are a city centroid rather than a campus is marked as such and yields CITY, not INSTITUTION. | §4.17, §6.2 |
| R56 One haversine | The formula lives once, in `src/domain/geo/distance.ts` (R = 6371.0088 km). `platform/db.ts` registers it at connection open as the SQL function `haversine_km(lat1, lon1, lat2, lon2)` by delegating to that same function — the path WP-03a proved with better-sqlite3 — so §8.2's bounding-box prefilter plus exact distance (WP-15a) and any in-process calculation can never disagree. Display wording is fixed: "~180 km (straight line)" (D-06). | §8.2, §6.4, D-06 |
| R57 Policy hides, never drops | The geography and event-type policies are two pure modules under `src/domain/policy/`, configured by the settings keys `geography.policy` and `eventType.policy`, which this module registers itself. An excluded event is **stored** with `visibility = POLICY_HIDDEN` and a stable `policy_reason`, so changing a policy needs no re-scrape. `visibleEvents()` is the single sanctioned base query (`visibility = 'VISIBLE' AND merged_into_event_id IS NULL`); every later read path builds on it. **Q12 stays open**: the default is `hybrid.ifOutsideAllowed = "SHOW_AS_ONLINE"` with the label "Hybrid — online participation", implemented as a setting, not a closed question. | §7.4, D-09, D-31, Q12 |
c) PROGRESS.md "Current": next WP is WP-09a; roadmap 17 done, 31 remaining. Q12 stays OPEN in
   DECISIONS.md **and** in ARCHITECTURE.md §2 — the two copies must be changed together (M0-review §4).

BUILD:
1. contracts — `packages/contracts/src/policy.ts`: `GeographyPolicy` and `EventTypePolicy` zod schemas
   whose defaults are §7.4's JSON verbatim (allowed types HACKATHON, IDEATHON, INNOVATION_CHALLENGE,
   CTF, CODING_CONTEST), `PolicyVerdict { visibility, reason?, label? }` with closed `reason` and
   `label` enums, and `DISTANCE_BUCKETS_KM = [50, 100, 250, 500]` (D-06). Add `GEO_` codes
   (`GEO_GAZETTEER_UNAVAILABLE`, `GEO_INVALID_COORDINATES`) per R12.
2. `tools/gazetteer/build.ts` + root script `gazetteer:build` (R53). Output schema: `places`
   (geonameid PK, name, ascii_name, `name_key` normalized, admin1_code, country_code, lat, lon,
   population, feature_code), `place_alt_names(place_id, name_key)` so "Bombay" finds Mumbai,
   `admin1(country_code, admin1_code, name, name_key)`, `gazetteer_meta(key, value)`; indexes on
   `(country_code, name_key)` and `name_key`. `--mini` writes the test fixture from the committed
   samples. Report the real row counts and the real file size.
3. `resources/institutions/seed.json` — a **starter set, capped at 150 rows**, not an attempt at
   completeness: the 23 IITs, the NITs, the IIITs, ~20 central/state/private universities and ~20
   well-known colleges. Per row: name, shortName, kind (§6.2 list), city, state, countryCode, lat, lon,
   `coordPrecision` (CAMPUS | CITY — R55), websiteDomain?, aliases[]. Coordinates come from the
   GeoNames dump you just downloaded; where it has no campus feature, use the city centroid and mark
   the row CITY. State the provenance in the seed header and in the handoff — never invent a coordinate.
   `src/modules/geo/seed.ts` upserts it idempotently on a natural key (kind + normalized name), carries
   a `seed_version`, and never overwrites a row an admin has edited. Audited as SYSTEM via `withAudit`.
4. `src/platform/gazetteer.ts` — opens the shipped DB read-only (`readonly: true, fileMustExist: true`)
   from the A20 resources path, degrades per R54, and is closed by a `resources`-phase shutdown hook
   (R14). It is never backed up (§6.2).
5. `src/domain/geo/` (pure): `normalize-name.ts` (lower-case, strip diacritics and punctuation, drop
   "the"/"institute of"/"college of" noise words, expand IIT/NIT/IIIT), `match.ts` (alias lookup then
   token-set scoring with a stated threshold), `distance.ts` (`haversineKm`, `boundingBox(center, km)`
   for §8.2's prefilter, `formatDistanceKm` → "~180 km (straight line)", "< 1 km" below one).
   `src/modules/geo/geocoder.ts` joins them to the two data sources and implements R55's ladder,
   returning `{ lat?, lon?, city?, state?, countryCode?, institutionId?, geoPrecision, warnings }`.
6. `src/domain/policy/geography.ts` and `event-type.ts` (pure, §7.4): in-person outside
   `allowCountries` → hidden; online → always allowed; hybrid evaluated on its physical location with
   `ifOutsideAllowed` applied (Q12 default `SHOW_AS_ONLINE` + the label); `unknownLocation:
   "SHOW_FLAGGED"` → visible with a flag, never hidden. `applyPolicies()` runs event type first, then
   geography, and returns the first hiding verdict so `policy_reason` is one stable string
   (e.g. `EVENT_TYPE_OUT_OF_SCOPE`, `IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES`). Register the two settings
   keys with `settings.define(...)` from this module — do not edit a central file.
7. `src/modules/events/{repository,service}.ts` — the minimum write and read path the criterion needs.
   `createEventFromCandidate(candidate, ctx)`: WP-08a's normalizer → geocode → `applyPolicies` →
   insert the `events` row plus its `event_deadlines` and `event_field_claims` rows, inside one
   transaction wrapped in `withAudit` (R35). `quality_score` gets a deliberately provisional pure
   `domain/events/quality.ts` (share of known key fields, 0–100), tuned later by WP-15b/16b — say so in
   a comment. Reads: `visibleEvents()` plus `getVisibleEventById`, `listVisibleEvents` (ordered, limited,
   no filters) and `countVisibleEvents` (R57). No routes.

TESTS (all in pnpm verify):
- **The §19 criterion:** a CTFtime-shaped in-person candidate in Seoul, Korea (the committed
  `detail-event-3417` fixture) is stored — a raw `SELECT` finds the row with
  `visibility = 'POLICY_HIDDEN'` and a `policy_reason` — and is absent from `listVisibleEvents`,
  `getVisibleEventById` and `countVisibleEvents`. Flipping `geography.policy.inPerson.allowCountries`
  to include `KR` and re-running `applyPolicies` on the stored row makes it visible **with no
  re-scrape**. A quiz/case-competition candidate is hidden the same way by the event-type policy.
- Geocoding ladder, one case per rung: source coordinates → EXACT · "Guru Nanak Institute of
  Technology, Kolkata" (the Devfolio fixture) → INSTITUTION · a CITY-precision seed row →
  CITY, not INSTITUTION · "Pune, Maharashtra" → CITY · "Kerala" alone → STATE · "India" alone →
  COUNTRY · empty → UNKNOWN. Ambiguity: two "Hyderabad" rows resolve by population within the state;
  a name present in two countries with no state resolves to COUNTRY with a warning.
  A spy on global `fetch` asserts it is never called (R55).
- Distance: known pairs (Kolkata–Delhi ≈ 1305 km, a point to itself = 0, antipodes); the SQL
  `haversine_km` and the domain function agree to 1e-9 over a generated table (R56);
  `boundingBox` never excludes a point inside the radius (fast-check); `formatDistanceKm(180.4)` is
  exactly "~180 km (straight line)".
- Gazetteer: `mini.db` opens read-only and a write is refused; a missing file degrades per R54 instead
  of throwing; `manifest.json` matches the committed samples' row counts.
- Institutions seed: every row validates, coordinates are inside India's bounding box, no duplicate
  natural key; re-running the seeder changes nothing; an admin-edited row survives a re-seed.
- Policy config: the defaults deserialize to §7.4's JSON exactly; an unknown key is rejected by the
  settings schema; each `policy_reason` value is in the contracts enum.

ACCEPTANCE: `pnpm verify` green **on a clean clone with no network and no `gazetteer.db`** (say how you
checked) · a policy-hidden event is stored and invisible to every read path (the §19 criterion) ·
`pnpm gazetteer:build` produces a DB whose row count and size you report · the institutions seed is
capped and its provenance stated · no network call in any geo path · `pnpm audit:deps` reported ·
files < 400 lines · nothing under `src/domain/**` imports drizzle, better-sqlite3, fastify or `node:fs`.

OUT OF SCOPE: Nominatim or any online geocoding (§4.17, stays off and unbuilt) · adapters, the
compliance gate and scrape runs (WP-09a/09b) · dedup, merge and field resolution (WP-10) · the query
builder, FTS5, facets and distance filtering in SQL (WP-15a) · any HTTP route or UI, including the
admin screens for editing institutions and correcting a location · packaging the gazetteer into the
installer (WP-31) · answering Q12.

Finish per CLAUDE.md (verify, PROGRESS.md ≤ 10 lines and < 150 total, docs/handoff/WP-08b.md, commit
"WP-08b: gazetteer, institutions seed, offline geocoder, distance and the visibility policies", print
the report). Report the gazetteer row count and file size, the institutions row count and where each
coordinate came from, the name-match threshold you chose and why, and confirm Q12 is still open.
