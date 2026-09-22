import type { Logger } from 'pino';

import type { SourceRow } from '../../db/schema/index.js';
import type { SettingsStore } from '../../platform/settings.js';
import type { SourceCredential } from '../../scraping/http/index.js';
import { resolveCredential } from './credentials.js';
import { parseSessionKey } from './seal.js';
import { resolveSessionCredential, sealStoredSessions, type SessionVault } from './session.js';

/**
 * Opening the session vault at startup (ruling R76).
 *
 * Small on purpose, and here rather than in `main.ts`, because it is the one
 * place that decides what a backend with no data key does — and that answer is
 * "carry on". A backend started by hand, in server mode, or on a machine where
 * the shell could not make a key runs exactly as it did before R74 existed: it
 * reads the sources' public pages, and Source status says why.
 */

export interface OpenVaultOptions {
  readonly settings: SettingsStore;
  /** `COMPINTEL_SESSION_KEY`, as the shell passed it; absent is a valid state. */
  readonly sessionKeyHex: string | undefined;
  /** Every source, so a session an older build left in the clear is sealed. */
  readonly sources: readonly SourceRow[];
  readonly logger: Logger;
}

/** The vault, with any pre-R76 plaintext session sealed on the way. */
export function openSessionVault(options: OpenVaultOptions): SessionVault {
  const vault: SessionVault = {
    settings: options.settings,
    key: parseSessionKey(options.sessionKeyHex),
  };
  if (vault.key === undefined) {
    options.logger.info(
      'no session key was passed, so stored sessions cannot be opened on this machine',
    );
    return vault;
  }
  const sealed = sealStoredSessions(options.sources, vault);
  if (sealed > 0) {
    // A count, never a value: the point of the migration is that the value stops
    // being readable, and logging it would undo that in the log file.
    options.logger.info({ sealed }, 'stored sessions were sealed at rest (R76)');
  }
  return vault;
}

/**
 * What a run may send as this source's credential: WP-11's documented API key,
 * or — for the two sources R74 allows it — the professor's own session.
 *
 * A source has at most one of the two. A session the site has already rejected,
 * and one this machine cannot open, are both simply absent.
 */
export function sourceCredentials(
  vault: SessionVault,
): (source: SourceRow) => SourceCredential | undefined {
  return (source) =>
    resolveCredential(source, vault.settings) ?? resolveSessionCredential(source, vault);
}
