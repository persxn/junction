# ADR-0006: Search: FTS5 + structured filters; no vector DB in MVP

- **Status:** Proposed
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §4.7, §8

## Context
Professors need keyword, fuzzy and structured filtering (type, category, mode, distance, deadlines,
fee, team size) with explainable ranking, and no extra services.

## Decision
- One `EventQuery` model (ADR-0003) is used everywhere.
- Structured filters → indexed SQL. Distance: bounding-box prefilter, then exact haversine via a registered SQL function.
- Text → `event_fts` (unicode61 + porter, diacritics removed; bm25 weights title 10, organizer 4,
  tags 3, description 1) plus `event_fts_trigram` on title + organizer. Both are external-content tables
  maintained by triggers. User text is escaped into quoted tokens. Admin-editable aliases expand terms.
- Facets via grouped SQL. Deterministic `RELEVANCE` ranking with human-readable "Why relevant?" reasons.
- Budgets (20k events, 8 GB host): query p95 < 100 ms, facets p95 < 150 ms, detail < 50 ms.

## Consequences
- Zero extra services. FTS adds ~30–60% to the events table size.
- No semantic similarity unless aliased or categorized.

## Alternatives considered
- Meilisearch/Typesense: an extra service to run.
- sqlite-vec + a small CPU embedding model: Phase 2, only if the AI eval shows recall gaps.
