# WP-08b — Gazetteer, institutions seed, offline geocoder, distance, visibility policies

**Status: DONE** · 21 Sep 2026 · spec v1.1.8, rulings **R53–R57** · `pnpm verify` green,
**2132 tests** (2038 at the end of WP-08a).

## 1. The §19 criterion

A CTFtime-shaped in-person event in Seoul is **stored**, not dropped (R57):

- a raw `SELECT` finds the row with `visibility = 'POLICY_HIDDEN'` and
  `policy_reason = 'IN_PERSON_OUTSIDE_ALLOWED_COUNTRIES'`;
- it is absent from `listVisibleEvents`, `getVisibleEventById`, `countVisibleEvents` and
  `visibleEvents`;
- adding `KR` to `geography.policy.inPerson.allowCountries` and calling `reapplyPolicies()` makes it
  visible **with no re-scrape**;
- a case competition is hidden the same way by the event-type policy, and widening `allowedTypes`
  brings it back.

`apps/backend/src/modules/events/service.test.ts`.

## 2. What shipped

| Area | Files |
|---|---|
| Contracts | `packages/contracts/src/policy.ts` — `GeographyPolicy`, `EventTypePolicy`, their §7.4 defaults, `PolicyReason`, `PolicyLabel`, `POLICY_LABEL_TEXT`, `PolicyVerdict`, `DISTANCE_BUCKETS_KM`. Plus the `GEO_AMBIGUOUS_PLACE` parse warning. |
| Gazetteer build | `tools/gazetteer/src/{build,zip}.ts`, root script `gazetteer:build`, `resources/gazetteer/{manifest.json,ATTRIBUTION.md,samples/}` |
| Gazetteer runtime | `apps/backend/src/platform/gazetteer.ts`, `src/testing/gazetteer.ts`, `test/fixtures/gazetteer/mini.db` |
| Pure geo | `src/domain/geo/{distance,match,normalize-name,index}.ts` |
| Pure policy | `src/domain/policy/{geography,event-type,index}.ts` |
| Geo module | `src/modules/geo/{geocoder,institutions,seed,settings}.ts`, `resources/institutions/seed.json` |
| Events module | `src/modules/events/{repository,service}.ts`, `src/domain/events/quality.ts` |
| Wiring | `platform/db.ts` registers `haversine_km`; `platform/resources.ts` locates the gazetteer; `main.ts` opens it, seeds institutions and builds the service |

**No routes and no UI**, as the prompt requires.

## 3. Numbers the prompt asks for

- **Gazetteer:** 588 362 places · 145 933 alias keys · 3 865 admin1 rows · **68.52 MB** (71 843 840
  bytes). Sources: `IN.zip` filtered to feature class P (15.75 MB download), `cities15000.zip`
  (3.36 MB), `admin1CodesASCII.txt` (0.15 MB). Every sha256 is in `manifest.json`.
- **Mini fixture:** 35 places · 240 alias keys · 19 admin1 rows · **53 248 bytes**, under R54's
  200 KB.
- **Institutions:** **116 rows** (cap 150). **11 rows are `CAMPUS`**, taken from a GeoNames feature
  class S entry; the other **105 are `CITY`**, the centroid of the institution's city. No coordinate
  is invented — the seed file says so in `coordinateSource` and a test asserts that sentence is
  there.
- **Name-match threshold: 0.82**, tie margin 0.05 (`domain/geo/match.ts`). Chosen so that
  "Guru Nanak Institute of Technology, Sodepur" still matches the seeded "Guru Nanak Institute of
  Technology" — the extra locality token costs it a little — while "National Institute of Technology
  Durgapur" does **not** match "…Rourkela", whose shared tokens are all the generic half of the name.
  Scoring is IDF-weighted over the candidate set for exactly that reason: "technology" appears in
  most of these names and distinguishes none of them. Below 0.82 the NITs start matching each other.
- **Q12 is still OPEN**, unchanged in both `ARCHITECTURE.md` §2 and `DECISIONS.md`. The default is
  `hybrid.ifOutsideAllowed = "SHOW_AS_ONLINE"` with the label "Hybrid — online participation",
  implemented as a setting.

## 4. Three bugs the tests caught

Each was invisible in review and each is now a test.

1. **A loose name match pinned institutions to the wrong state.** The seed generator accepted any
   GeoNames class-S feature sharing the short name's tokens, which put **Jadavpur University in
   Rajasthan, PES University in Bihar and SRM in Punjab**. Now: exact normalized-name or alias match
   **and** within 60 km of the institution's own city. `seed.test.ts` keeps it that way.
2. **The §8.2 bounding-box prefilter could drop a point exactly on the circle** by one unit in the
   last place. A false negative there loses an event permanently — the exact distance that would
   have kept it never runs — so the box now pads outward by 1e-9°. Found by a fast-check property.
3. **The re-seed's "has an admin edited this?" check compared the stored row against the *new*
   seed**, so a row the seed itself was moving always looked edited and every legitimate update was
   skipped. Now the payload carries a hash of what the seed last wrote, which answers the actual
   question.

## 5. Decisions worth the architect's eye

1. **A dependency-free ZIP reader** (`tools/gazetteer/src/zip.ts`, ~40 lines of `node:zlib`). This
   build script is the only thing in the repository that reaches the internet, so its supply chain is
   the one that matters most; the format has not changed since 1989 and a failure is loud, at build
   time, on a developer's machine.
2. **`coordPrecision` rides in `institutions.aliases_json`.** §6.2 does not list a column for it, and
   adding one would mean a migration the spec does not describe. It is stored alongside the aliases
   as `{ aliases, coordPrecision, seedVersion, valuesHash }`. WP-16b can promote it to a column if
   the admin screen wants it.
3. **`GEO_COORDINATES_INVALID` kept** over the prompt's `GEO_INVALID_COORDINATES`; pre-M1 shipped the
   former and nothing depends on the spelling. `GEO_GAZETTEER_UNAVAILABLE` already existed.
4. **`applyPolicies` runs event type before geography** so `policy_reason` is one stable string. Type
   is the more fundamental judgement — a quiz in Mumbai is out of scope whatever the geography policy
   says — and reversing the order would make the stored reason depend on which rule happened to run
   first, so an admin would widen the wrong one.
5. **An unclassifiable event is not an out-of-scope event.** A confident `OTHER` is hidden; an
   `OTHER` with confidence below 0.9 is shown flagged, because burying everything the classifier
   failed on is how a feed quietly loses half its events.
6. **`geography.policy` and `geography.nearbyRadiusKm` moved** from `modules/org/settings.ts` to
   `modules/geo/settings.ts`, which is exactly what pre-M1's comment in that file predicted. Key and
   default unchanged; `settings.test.ts` asserts the full key list, now ten.

## 6. Questions for the architect

1. **The gazetteer is 68.5 MB, and 95% of it is noise.** R53 says "IN.zip filtered to feature class
   P", and that is what the build does. But of 557 995 Indian rows, only **7 140 have any population
   figure at all** — the rest are hamlets with population 0. They inflate the shipped file eightfold
   *and* actively harm matching, because R55's population tie-break cannot separate two rows that are
   both zero, so the geocoder is forced to drop a rung. §4.17 says "India **towns/cities**", which
   reads narrower than class P. Options, with numbers: population > 0 → 7 140 rows; population ≥ 5 000
   → 6 534; plus all 451 administrative seats regardless. Any of those would cut the file to a few
   MB and improve city resolution. I have followed R53 literally and not deviated. **Worth a ruling
   before WP-31 packages this into the installer.**
2. **The `INSTITUTION` rung is mostly unreachable.** GeoNames carries almost no Indian campuses — 101
   class-S university/school rows in the entire country dump, and none of the IITs or NITs by name.
   So 105 of 116 seed rows are city centroids and resolve to `CITY`. That is honest, but it means
   "within 5 km of campus" is not answerable for most institutions until someone curates coordinates
   by hand. WP-16b's admin edit is the escape hatch; is a curation pass worth scheduling?

## 7. Notes for WP-09a

- `pnpm gazetteer:build` needs network; `pnpm gazetteer:build --mini` does not and rebuilds the
  committed fixture from `resources/gazetteer/samples/`.
- The events service is constructed in `main.ts` but nothing routes to it — WP-09b is the first
  caller. `createEventFromCandidate(candidate, { sourceRecordId })` takes the id with no FK behind it
  (R49).
- `visibleEvents()` is the only sanctioned base query (R57). Build on it; do not write a bare
  `select * from events`.
- Heredocs still corrupt regexes and escapes — see WP-08a's handoff §9. Two files in this WP were
  written with the Write tool for exactly that reason.
