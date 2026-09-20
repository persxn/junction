import { networkInterfaces } from 'node:os';

/** Prefixes an interface self-assigns when DHCP or router discovery never answered. */
const LINK_LOCAL_V4 = '169.254.';
const LINK_LOCAL_V6 = 'fe80:';

/**
 * "Does this machine have a usable network?", answered without touching the
 * network (D-23, §4.9). It only looks at the interface table: a non-internal
 * address that is not link-local means something is plugged in or associated.
 *
 * This deliberately cannot tell a captive portal or a dead uplink from a working
 * one - that is what the scrape itself reports, as `NETWORK`/`DNS` in
 * `scrape_runs.error_kind` (§6.2). The point of the check is to keep a laptop on
 * a train from turning every cadence into a failure streak and a 12-hour
 * backoff. A real reachability probe is a network call, so it belongs to the
 * polite HTTP client in WP-11, not here.
 */
export function hasNetworkInterface(): boolean {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.internal) {
        continue;
      }
      if (address.family === 'IPv4' && !address.address.startsWith(LINK_LOCAL_V4)) {
        return true;
      }
      if (address.family === 'IPv6' && !address.address.toLowerCase().startsWith(LINK_LOCAL_V6)) {
        return true;
      }
    }
  }
  return false;
}
