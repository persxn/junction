import { InstallationMode } from '@compintel/contracts';
import type { InstallationMode as Mode } from '@compintel/contracts';

import { define } from '../../platform/settings.js';

/**
 * R130: what the first-run wizard set this installation up as. Written once,
 * inside setup's transaction; no route changes it. The default is DEPARTMENT so
 * a database from before WP-34 — which has no row — reads as what it is.
 */
export const INSTALLATION_MODE = define<Mode>('installation.mode', {
  schema: InstallationMode,
  default: 'DEPARTMENT',
  description: 'Department or student install, chosen at first run and fixed afterwards.',
});
