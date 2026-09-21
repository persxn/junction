import { EventCandidate, type ParseWarning, type UrlImportResult } from '@compintel/contracts';
import type { Logger } from 'pino';

import type { SourceRow } from '../../../db/schema/index.js';
import {
  foundFromCandidate,
  importFields,
  rawFromFound,
} from '../../../domain/import/candidate.js';
import { extractEvent } from '../../../domain/import/extract.js';
import { foundAnything, FOUND_LABELS, FOUND_FIELDS } from '../../../domain/import/found.js';
import {
  resolveImportRoute,
  type ImportRoute,
  type ImportSource,
} from '../../../domain/import/route.js';
import { normalizeCandidate } from '../../../domain/normalize/index.js';
import { loadHtmlParser, parseHtml } from '../../../adapters/shared/html.js';
import type { Clock } from '../../../platform/time.js';
import type { ScrapingHttp, SourceCredential } from '../../../scraping/http/index.js';
import { sourceConfig, sourceRequestContext } from '../../../scraping/source-row.js';
import type { AdapterRegistry } from '../../../sources/registry.js';
import { importExtractionFailed, importUrlInvalid } from './errors.js';
import { fetchImportPage } from './fetch.js';

/**
 * The preview: what a pasted link turns out to be, before anything is written
 * (§7.1's URL-import bullet, D-30, WP-14 steps 2-5).
 *
 * Nothing here writes a row. That is the whole point of a separate call: the
 * professor sees what was read, what was *not* read, and where each value came
 * from, and then decides. A preview that saved as it went would make "let me
 * check that" impossible.
 *
 * The dispatch is a pure function over the live `sources` rows, so a domain that
 * belongs to a MANUAL_IMPORT_ONLY source is answered without a request of any
 * kind — robots.txt included.
 */

export interface PreviewDependencies {
  readonly registry: AdapterRegistry;
  readonly http: ScrapingHttp;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly credentials?: (source: SourceRow) => SourceCredential | undefined;
  readonly signal?: AbortSignal;
}

/** What the commit needs from the preview it is committing. */
export interface PreviewedImport {
  readonly candidate: EventCandidate;
  readonly sourceKey: string;
  readonly raw?: Uint8Array;
}

export interface PreviewOutcome {
  readonly result: UrlImportResult;
  /** Absent for MANUAL_ONLY: nothing was read, so there is nothing to commit. */
  readonly previewed?: PreviewedImport;
}

/** The `sources` table as the dispatcher sees it (WP-14 step 2). */
export function importSources(
  rows: readonly SourceRow[],
  registry: AdapterRegistry,
): ImportSource[] {
  return rows.map((row) => {
    let hosts: string[];
    try {
      const parsed = (JSON.parse(row.configJson) as { hosts?: unknown }).hosts;
      hosts = Array.isArray(parsed)
        ? parsed.filter((host): host is string => typeof host === 'string')
        : [];
    } catch {
      hosts = [];
    }
    const adapter = registry.get(row.key);
    return {
      key: row.key,
      name: row.name,
      complianceStatus: row.complianceStatus,
      isEnabled: row.isEnabled,
      hosts,
      canDetail: adapter?.detail !== undefined && adapter.itemFromUrl !== undefined,
      complianceNotes: row.complianceNotes,
    };
  });
}

/** Every field label, for a result where nothing was read. */
function allLabels(): string[] {
  return FOUND_FIELDS.map((field) => FOUND_LABELS[field]);
}

/** The answer for a domain we do not read automatically (D-30). No request. */
export function manualOnlyResult(
  route: Extract<ImportRoute, { disposition: 'MANUAL_ONLY' }>,
): UrlImportResult {
  return {
    disposition: 'MANUAL_ONLY',
    url: route.url,
    sourceKey: route.source.key,
    sourceName: route.source.name,
    reason: route.reason,
    fieldsFound: [],
    fieldsMissing: allLabels(),
    warnings: [],
  };
}

function resultOf(
  disposition: 'ADAPTER' | 'GENERIC',
  url: string,
  candidate: EventCandidate,
  source: { key: string; name: string } | undefined,
  found: ReturnType<typeof foundFromCandidate>,
): UrlImportResult {
  const { fieldsFound, fieldsMissing } = importFields(found);
  const warnings: readonly ParseWarning[] = candidate.warnings;
  return {
    disposition,
    url,
    ...(source === undefined ? {} : { sourceKey: source.key, sourceName: source.name }),
    candidate,
    fieldsFound,
    fieldsMissing,
    warnings: [...warnings],
  };
}

/** The approved-source path: that adapter's own `detail()` and `normalize()`. */
async function previewWithAdapter(
  deps: PreviewDependencies,
  row: SourceRow,
  route: Extract<ImportRoute, { disposition: 'ADAPTER' }>,
): Promise<PreviewOutcome> {
  const adapter = deps.registry.get(route.source.key);
  const item = adapter?.itemFromUrl?.(route.url);
  if (adapter?.detail === undefined || item === undefined) {
    // On the source's domain, but not one of its event pages. Nothing is
    // requested and the form opens with the link attached.
    return {
      result: manualOnlyResult({
        disposition: 'MANUAL_ONLY',
        url: route.url,
        source: route.source,
        reason: `That link is on ${route.source.name}, but it is not one of its event pages, so there was nothing to read. Type the details in — the link is saved with the event.`,
      }),
    };
  }
  const config = sourceConfig(row);
  const client = deps.http.clientFor(
    sourceRequestContext(row, deps.credentials?.(row)),
    deps.signal ?? new AbortController().signal,
    { maxRequests: 1 },
  );
  const context = {
    http: client,
    log: deps.logger.child({ source: row.key, import: true }),
    clock: deps.clock,
    now: () => deps.clock.now(),
    signal: deps.signal ?? new AbortController().signal,
    config: config.raw,
  };
  const detail = await adapter.detail(context, item);
  const normalized = adapter.normalize(detail, {
    clock: deps.clock,
    sourceKey: row.key,
    defaultTimeZone: config.defaultTimeZone,
  });
  const candidate = EventCandidate.parse(normalized);
  return {
    result: resultOf('ADAPTER', route.url, candidate, route.source, foundFromCandidate(candidate)),
    previewed: {
      candidate,
      sourceKey: row.key,
      ...(detail.raw === undefined ? {} : { raw: detail.raw }),
    },
  };
}

/** The generic path: one robots-checked page, read once, nothing followed. */
async function previewGeneric(
  deps: PreviewDependencies,
  row: SourceRow,
  url: string,
): Promise<PreviewOutcome> {
  const page = await fetchImportPage(
    { http: deps.http, source: row, ...(deps.signal === undefined ? {} : { signal: deps.signal }) },
    url,
  );
  await loadHtmlParser();
  const found = extractEvent({ html: page.html, url, parse: parseHtml });
  if (!foundAnything(found)) {
    throw importExtractionFailed(url);
  }
  const raw = rawFromFound({ sourceKey: row.key, externalKey: url, url }, found);
  if (raw.title === undefined || raw.title.length === 0) {
    throw importExtractionFailed(url);
  }
  // §7.3's precedence: the source's default zone, which for the `url-import`
  // row is the installation's own (Asia/Kolkata). Without it every prose date
  // on a campus page would be read as UTC and have its precision lowered for
  // it, which loses the day the professor can see written on the page.
  const { candidate } = normalizeCandidate(raw, {
    clock: deps.clock,
    sourceTimezone: sourceConfig(row).defaultTimeZone,
  });
  return {
    result: resultOf('GENERIC', url, candidate, undefined, found),
    previewed: {
      candidate,
      sourceKey: row.key,
      raw: new TextEncoder().encode(page.html),
    },
  };
}

/** Dispatches one URL and reads at most one page. Writes nothing. */
export async function previewImport(
  deps: PreviewDependencies,
  rows: readonly SourceRow[],
  urlImportRow: SourceRow,
  rawUrl: string,
): Promise<PreviewOutcome> {
  const route = resolveImportRoute(rawUrl, importSources(rows, deps.registry));
  if (route.disposition === 'INVALID') {
    throw importUrlInvalid(route.reason);
  }
  if (route.disposition === 'MANUAL_ONLY') {
    return { result: manualOnlyResult(route) };
  }
  if (route.disposition === 'ADAPTER') {
    const row = rows.find((candidate) => candidate.key === route.source.key);
    if (row === undefined) {
      throw importUrlInvalid(`${route.source.key} is not configured on this installation.`);
    }
    return previewWithAdapter(deps, row, route);
  }
  return previewGeneric(deps, urlImportRow, route.url);
}
