import type { Logger } from 'pino';

import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { openGazetteer, unavailableGazetteer, type Gazetteer } from '../../platform/gazetteer.js';
import type { ResourcePaths } from '../../platform/resources.js';
import type { ShutdownRegistry } from '../../platform/shutdown.js';
import { Geocoder } from './geocoder.js';
import { PlacesService } from './places.js';
import { loadInstitutions, loadSeedFile, seedInstitutions } from './seed.js';

/**
 * Geography at start-up (§4.17, rulings R53–R55), moved out of `main.ts`.
 *
 * The gazetteer is reference data the build produces; a missing one is a
 * warning and a geocoder that answers UNKNOWN, never a failed start (R54). The
 * institutions seed is idempotent, so running it every start costs one query and
 * keeps a fresh install correct without a separate step. In the packaged bundle
 * the gazetteer needs the SQLite addon's explicit path, like the main database.
 */

export interface GeographyOptions {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly logger: Logger;
  readonly shutdown: ShutdownRegistry;
  readonly resources: ResourcePaths;
}

export interface Geography {
  readonly gazetteer: Gazetteer;
  readonly geocoder: Geocoder;
  /** WP-34: the first-run wizard's location picker. */
  readonly places: PlacesService;
}

export function openGeography(options: GeographyOptions): Geography {
  const { db, logger, resources } = options;
  const gazetteer =
    resources.gazetteerFile === undefined
      ? unavailableGazetteer('no gazetteer was built; run `pnpm gazetteer:build`')
      : openGazetteer(resources.gazetteerFile, {
          logger,
          shutdown: options.shutdown,
          nativeBinding: resources.nativeBinding,
        });
  if (!gazetteer.available) {
    logger.warn(
      { reason: gazetteer.unavailableReason },
      'geocoding will answer UNKNOWN until a gazetteer is built',
    );
  }
  const seeded = seedInstitutions(db, options.audit, {
    ...(resources.institutionsSeedFile === undefined
      ? {}
      : { seed: loadSeedFile(resources.institutionsSeedFile) }),
  });
  logger.info(seeded, 'institutions seeded');
  return {
    gazetteer,
    geocoder: new Geocoder({ gazetteer, institutions: loadInstitutions(db) }),
    places: new PlacesService(db, gazetteer),
  };
}
