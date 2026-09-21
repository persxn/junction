import { createCtftimeAdapter } from '../adapters/ctftime/adapter.js';
import type { CtftimeGeo } from '../adapters/ctftime/map.js';
import type { SourceAdapter } from './types.js';

/**
 * The adapter registry — empty until {@link registerBuiltInAdapters} runs.
 *
 * This work package builds the machinery: the polite client, the compliance
 * gate, the orchestrator, the run and record tables, the jobs. It ships no
 * adapter at all, exactly as WP-04c shipped a job runner with no jobs.
 *
 * The consequence is worth spelling out, because it is the design and not an
 * oversight: `scrape:<source>` jobs are registered from *the intersection of*
 * this registry and the enabled, approved rows in `sources`. With the registry
 * empty, no scrape job exists and nothing can make a request even if somebody
 * enables a source by hand. WP-09b registers CTFtime here and its job appears on
 * its own, with no wiring to add.
 *
 * `MANUAL` and `URL_IMPORT` sources never appear here: they have rows so an
 * event has provenance, but no code that walks a listing.
 */
export class AdapterRegistry {
  readonly #adapters = new Map<string, SourceAdapter>();

  /** Registering the same key twice throws: two adapters for one source is a bug. */
  register(adapter: SourceAdapter): void {
    if (this.#adapters.has(adapter.key)) {
      throw new TypeError(`An adapter is already registered for source "${adapter.key}".`);
    }
    this.#adapters.set(adapter.key, adapter);
  }

  get(key: string): SourceAdapter | undefined {
    return this.#adapters.get(key);
  }

  has(key: string): boolean {
    return this.#adapters.has(key);
  }

  /** Every registered adapter, in registration order. */
  all(): readonly SourceAdapter[] {
    return [...this.#adapters.values()];
  }

  get size(): number {
    return this.#adapters.size;
  }
}

/**
 * The registry the backend uses. Adapter work packages add their adapter to
 * {@link registerBuiltInAdapters}; nothing else here changes.
 */
export const adapterRegistry = new AdapterRegistry();

/** What the built-in adapters need from the running backend. */
export interface BuiltInAdapterDependencies {
  /** WP-08b's geocoder, for place names in listings. */
  readonly geo: CtftimeGeo;
}

/**
 * Registers every adapter this build ships. Called once from `main.ts`, after
 * the geocoder exists and before the scrape jobs are registered, so each
 * `scrape:<source>` job appears from the registry and the `sources` rows alone.
 *
 * - `ctftime` — WP-09b.
 */
export function registerBuiltInAdapters(
  registry: AdapterRegistry,
  deps: BuiltInAdapterDependencies,
): void {
  registry.register(createCtftimeAdapter({ geo: deps.geo }));
}
