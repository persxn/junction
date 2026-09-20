# Gazetteer attribution

`gazetteer.db` is built from **GeoNames** geographical data.

- Source: <https://download.geonames.org/export/dump/>
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)** —
  <https://creativecommons.org/licenses/by/4.0/>
- Files used: `IN.zip` (India, filtered to feature class P — populated places),
  `cities15000.zip` (world, population ≥ 15 000), `admin1CodesASCII.txt` (state and province names).

CC BY 4.0 requires attribution, so **this credit is shown in the app's About screen**, not only
here. The exact source URLs, the filters applied, the row counts and a SHA-256 of each downloaded
file are recorded in `manifest.json` next to this file, which is what makes the build reproducible
from git alone (ruling R53).

GeoNames data is provided "as is" with no warranty. Coordinates are frequently a settlement centroid
rather than a precise address, which is why every resolved location carries a `geo_precision` and
every distance is labelled "(straight line)".

## What is committed and what is not

|                                                |                                                                                                                           |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `manifest.json`, `ATTRIBUTION.md`, `samples/`  | **committed** — small, and they make the build reproducible                                                               |
| `gazetteer.db`                                 | **not committed** (R53) — tens of megabytes; build it with `pnpm gazetteer:build`                                         |
| `apps/backend/test/fixtures/gazetteer/mini.db` | **committed** — ≤ 200 KB, built from `samples/` by `pnpm gazetteer:build --mini`, so `pnpm verify` needs no network (R54) |

The samples in `samples/` are rows copied verbatim out of the GeoNames dumps. No coordinate anywhere
in this project is invented.
