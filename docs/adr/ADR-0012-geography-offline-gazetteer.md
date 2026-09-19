# ADR-0012: Geography: offline gazetteer + institutions; straight-line distance; configurable geography policy

- **Status:** Accepted (spec v1.1, 2026-09-20) — amended
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-06, D-09, D-16), §4.17, §6.4, §7.4

## Context
Distance from the configured campus drives filters (50/100/250/500 km/Anywhere). In-person events are
India only, online is worldwide, and hybrid is judged by physical location. Budget is ₹0 and the app must work offline.

## Decision
- A read-only `gazetteer.db` from GeoNames (India towns/cities + world cities > 15k; CC BY 4.0, credited in About)
  plus a curated, admin-editable **institutions** seed (IITs, NITs, IIITs, major universities: coordinates,
  aliases, domains).
- Resolution order: source coordinates → institution → city + state → city → unknown. Store
  `geo_precision`. User corrections are audited overrides.
- Distance = haversine to the primary campus at query time, shown as "~180 km (straight line)".
- One configurable geography-policy module. Excluded events are stored with `visibility = POLICY_HIDDEN` + a reason,
  so a policy change needs no re-scrape. Hybrid events outside India default to "Hybrid — online participation" [OPEN Q12].
- Nominatim (≤ 1 req/s) is an optional fallback for URL imports only, off by default.

## Consequences
- Works offline and at zero cost. Straight-line distance is not travel distance, and the label says so.
- The gazetteer and institutions seed must be built and maintained.

## Alternatives considered
- Nominatim or other online geocoding as the primary: rate-limited and needs a network.
- Road routing: paid or heavy.

## Amendments (v1.1)
- An event-type policy (tech types only in MVP, D-31) sits next to the geography policy and hides out-of-scope types the same way.
