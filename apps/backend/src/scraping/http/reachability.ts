import type { HttpEnvironment } from './polite-client.js';
import { hostKey } from './queue.js';
import { REACHABILITY_TTL_MS, ScrapeRequestError, type PoliteResponse } from './types.js';

/**
 * R61's confirming probe: a HEAD to the source's own host, through the gate and
 * the politeness queue like any other request, cached for five minutes so a run
 * costs at most one. Offline is not a failure, so a probe that fails answers
 * `false` rather than throwing.
 *
 * `head` is the client's own method, passed in so the probe goes through the
 * same gate, queue and budget as everything else the run does.
 */
export async function probeReachability(
  env: HttpEnvironment,
  url: string,
  online: boolean,
  head: (url: string) => Promise<PoliteResponse>,
): Promise<boolean> {
  if (!online) {
    return false;
  }
  let key: string;
  try {
    key = hostKey(new URL(url));
  } catch {
    return false;
  }
  const now = env.clock.now().getTime();
  const cached = env.reachability.get(key);
  if (cached !== undefined && now - cached.at < REACHABILITY_TTL_MS) {
    return cached.reachable;
  }
  let reachable: boolean;
  try {
    const response = await head(url);
    reachable = response.status < 500;
  } catch (error) {
    reachable = error instanceof ScrapeRequestError && error.kind === 'BLOCKED';
    env.logger.debug({ host: key }, 'reachability probe failed');
  }
  env.reachability.set(key, { at: env.clock.now().getTime(), reachable });
  return reachable;
}
