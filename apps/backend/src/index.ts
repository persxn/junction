import { API_VERSION } from '@compintel/contracts';

export interface BuildInfo {
  readonly name: string;
  readonly apiVersion: string;
}

/**
 * Identifies this backend build. Fastify, the database and the HTTP surface arrive
 * in WP-04a onward; for now this exists to prove the workspace wiring end to end.
 */
export function describeBuild(): BuildInfo {
  return { name: '@compintel/backend', apiVersion: API_VERSION };
}
