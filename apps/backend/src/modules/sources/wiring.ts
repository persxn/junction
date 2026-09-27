import type { Logger } from 'pino';

import { hasNetworkInterface } from '../../jobs/online.js';
import type { Config } from '../../platform/config.js';
import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { SettingsStore } from '../../platform/settings.js';
import type { ShutdownRegistry } from '../../platform/shutdown.js';
import {
  HttpCacheStore,
  ScrapingHttp,
  closeTransport,
  undiciFetcher,
} from '../../scraping/http/index.js';
import type { RunFinished } from '../../scraping/run.js';
import { createSessionHooks } from '../../scraping/sessions.js';
import { SnapshotStore } from '../../scraping/snapshots.js';
import { adapterRegistry, registerBuiltInAdapters } from '../../sources/registry.js';
import type { Geocoder } from '../geo/geocoder.js';
import { EventImportService } from '../events/import/service.js';
import type { EventsModule } from '../events/wiring.js';
import { SCRAPER_CONTACT_EMAIL } from '../org/settings.js';
import { ConnectPromptService } from './connect-prompt.js';
import { seedDevCredentials } from './credentials.js';
import { SourceRecordsRepository } from './records.js';
import { SourcesRepository } from './repository.js';
import { SourcesService } from './service.js';
import { openSessionVault, sourceCredentials } from './vault.js';

/**
 * Everything that reads an event out of a source, wired once (§7, §3.2).
 *
 * `main.ts` used to hold this block inline and had grown past the 400-line cap;
 * the events, search and categories modules already had wiring files of their
 * own, so this is the fourth of the same kind rather than a new idea. The order
 * inside matters and is the reason it is one function: the HTTP transport must
 * exist before anything that could make a request, the session vault (R76) must
 * be opened before the service that reads a sealed cookie through it, and the
 * dev credential seed must run before the vault reads one.
 */

export interface SourcesModuleDependencies {
  readonly db: DatabaseHandle;
  readonly config: Config;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly logger: Logger;
  readonly shutdown: ShutdownRegistry;
  readonly geocoder: Geocoder;
  readonly events: Pick<EventsModule, 'linker' | 'provenance' | 'resolver'>;
  /** A10/R44: nothing is contacted before the wizard has finished. */
  readonly setupComplete: () => boolean;
  /** WP-15a: the typo vocabulary is rebuilt after anything lands. */
  readonly onIngested: () => void;
  /** R86: every closed run is announced on the SSE hub. */
  readonly onRunFinished: (event: RunFinished) => void;
}

export interface SourcesModule {
  readonly service: SourcesService;
  readonly imports: EventImportService;
  /** R74's one-time onboarding step, and whether it is still owed. */
  readonly connectPrompt: ConnectPromptService;
  /** What `scrape:<source>` and `detail-refresh` need (WP-09a registers them). */
  readonly scrapeRuntime: {
    readonly records: SourceRecordsRepository;
    readonly http: ScrapingHttp;
    readonly snapshots: SnapshotStore;
    readonly linker: EventsModule['linker'];
  };
}

export function createSourcesModule(deps: SourcesModuleDependencies): SourcesModule {
  const { db, config, settings, audit, logger } = deps;

  // The transport is the only place a socket is opened, and it is injected here
  // and nowhere else: every test passes a fake, which is what makes "no test
  // opens an internet socket" something the wiring guarantees rather than
  // something a reviewer checks.
  const http = new ScrapingHttp({
    fetcher: undiciFetcher,
    logger,
    cache: new HttpCacheStore(db),
    appVersion: config.appVersion,
    contactEmail: () => settings.get(SCRAPER_CONTACT_EMAIL),
    setupComplete: deps.setupComplete,
    hasNetworkInterface,
  });
  deps.shutdown.register('resources', 'scraping-transport', closeTransport);
  const snapshots = new SnapshotStore({ config, logger });
  registerBuiltInAdapters(adapterRegistry, { geo: deps.geocoder });

  const sources = new SourcesRepository(db);
  const records = new SourceRecordsRepository(db);
  // WP-11: in --dev only, env vars may seed the CLIST credential (never logged).
  if (seedDevCredentials(settings, config.dev, process.env)) {
    logger.info('a CLIST credential was seeded from the environment (--dev)');
  }
  // R76: the shell's data key, or nothing — nothing is a supported state.
  const vault = openSessionVault({
    settings,
    sessionKeyHex: config.sessionKeyHex,
    sources: sources.list(),
    logger,
  });
  const credentials = sourceCredentials(vault);

  const imports = new EventImportService({
    sources,
    records,
    linker: deps.events.linker,
    provenance: deps.events.provenance,
    resolver: deps.events.resolver,
    geocoder: deps.geocoder,
    registry: adapterRegistry,
    http,
    audit,
    logger,
    snapshots,
    credentials,
    onIngested: deps.onIngested,
  });

  const service = new SourcesService({
    sources,
    records,
    registry: adapterRegistry,
    audit,
    logger,
    settings,
    sessionKey: vault.key,
    runtime: {
      http,
      snapshots,
      linker: deps.events.linker,
      credentials,
      sessions: createSessionHooks(vault),
      setupComplete: deps.setupComplete,
      onRunFinished: deps.onRunFinished,
    },
    onIngested: deps.onIngested,
  });

  return {
    service,
    imports,
    connectPrompt: new ConnectPromptService({ settings, sources, audit }),
    scrapeRuntime: { records, http, snapshots, linker: deps.events.linker },
  };
}
