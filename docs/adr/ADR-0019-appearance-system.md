# ADR-0019: Appearance system — a palette layer under the semantic tokens, three effect tiers, and insights that are computed rather than invented

- **Status:** Accepted (spec v1.1.6, 2026-09-20)
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §16.2, §16.3, §19 (M4.5 / WP-33), §21 (R67, R68, R69); D-25, D-11
- **Supersedes nothing.** Extends §16.3, which described a single neutral theme with functional motion only.

## Context

The product owner wants the app to be something a professor *wants* to open: glows, gradient and text
animations, animated loading and progress states, RGB presets, and a surface that shows what the
department has actually achieved. The request is explicitly for an app that feels rewarding to use.

Four things already in the spec pull the other way, and all four are load-bearing rather than
decorative preferences:

1. **D-25 and the accessibility baseline.** WP-06 shipped a *measured* contrast test — every text/surface
   pair is asserted at ≥ 4.5:1 in a unit test, in both themes. Catppuccin's accent hues do not all clear
   that bar as text on their own base colours.
2. **§16.3's motion rule** — "120–200 ms ease-out for drawers, popovers and list changes only; no
   decorative loops; honours reduced-motion" — and its state rule, "every status = icon + label (+
   colour). Never colour alone."
3. **The 72-hour tray soak in WP-32.** This app lives in the tray for days at a time on one professor's
   machine. Continuous decorative animation is a battery and CPU cost paid while nobody is looking.
4. **D-11 and §9.2** — the app does not fabricate. An "engagement" surface built on invented or
   extrapolated numbers would be the same failure in a friendlier costume.

Refusing the request outright would be the wrong call: none of the four objections is to *visual
richness*, they are to specific mechanisms. The decision below keeps the richness and removes the
mechanisms that would have cost accessibility, battery or honesty.

## Decision

**1. A palette layer, beneath the semantic tokens, not instead of them (R67).**
WP-06's `--ci-*` tokens stay exactly as they are — they are what every component references, and
renaming them would rewrite the UI to change a colour. Underneath sits a swappable palette: Catppuccin
**Latte** (default light), **Mocha** (default dark), **Frappé** and **Macchiato** optional, and
**Classic** — the existing neutrals — retained. The measured contrast test is the arbiter: accent hues
take non-text roles (borders, glows, chart marks, fills) and text uses each flavour's `text`/`subtext`
ramp, adjusted until every pair passes in every flavour. A palette value that fails is remapped, never
exempted.

**2. Three effect tiers, with CALM as a real product state (R68).**
`appearance.effects` ∈ { CALM, STANDARD, SHOWCASE }. STANDARD is the default and is what §16.3 already
described plus gradients, hover glows, shimmer skeletons, eased progress bars and animated counters.
SHOWCASE adds animated gradient borders, glow pulses, gradient text sweeps and RGB hue-cycle presets.
CALM is none of it. Three constraints make the tiers safe rather than merely optional:

- `prefers-reduced-motion: reduce` **forces** CALM regardless of the stored setting.
- No effect carries meaning alone. "Never colour alone" becomes "never glow alone": CALM loses styling,
  never information, and a test asserts identical accessible names and text content across tiers.
- Decorative animation uses compositor-only properties and **stops when the document is hidden or the
  window is in the tray**, so the soak in WP-32 passes with SHOWCASE on.

**3. Insights are computed, never invented (R69).**
The rewarding surface is real data: participation over time, the engagement funnel and its conversion,
outcome distribution, per-student and per-team counts, mentor load, deadline-hit rate, **source
contribution** (which ingestion sources produced events that were actually assigned) and streaks. All of
it comes from deterministic SQL read models over rows the app already holds — no AI commentary (§9 is
read-only), no estimates, no extrapolation, and no new data collection or telemetry of any kind. A fresh
install gets an empty state describing what will appear, not a page of zeros. Milestone celebrations are
permitted at STANDARD and SHOWCASE (never at CALM) as one-shot, dismissible acknowledgements of
recorded outcomes; streak-loss warnings,
artificial urgency and counters that exist only to be incremented are not.

## Consequences

- The contrast test grows from one theme pair to a matrix of five flavours × two modes. That is the
  intended cost: it is what keeps "make it prettier" from quietly becoming "make it harder to read".
- Some Catppuccin combinations a user might expect from other apps will not appear verbatim, because the
  text ramp is used where the raw accent would fail. The flavour is recognisable; the exact pairing is
  not always identical.
- SHOWCASE is a supported configuration, so WP-32's soak and performance pass must cover it. If an
  effect cannot hold 60 fps on the 8 GB reference tier or cannot idle at ~0 % CPU in the tray, it is cut
  in WP-33 rather than defended during the pilot.
- The Insights read models add query surface that WP-28's export path and WP-30's health screen can
  reuse.

## Alternatives considered

- **Ship Catppuccin as a straight token replacement.** Fastest, and it breaks the measured contrast
  guarantee for several pairs — the one UI property this project has tested since WP-06.
- **Effects always on, no tiers.** Simpler code, but it makes reduced-motion users second-class and
  turns the tray soak into a gamble.
- **A charting library up front.** Deferred to a justification in WP-33: six to eight chart shapes,
  hand-rolled SVG, accessible fallbacks and five flavours to theme is a smaller problem than theming and
  auditing someone else's renderer.
- **Engagement mechanics (streak pressure, badges for activity rather than outcomes).** Rejected on the
  same grounds as fabricated data: the app's value is that its numbers can be trusted, and a metric that
  exists to change behaviour rather than to describe it is not trustworthy.
