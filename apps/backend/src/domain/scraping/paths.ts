/**
 * `sources.allowed_paths_json`, as a grammar (§7.2: "Requests are limited to the
 * source's `allowed_paths_json`").
 *
 * Every entry is **host-qualified**. A bare path authorizes nothing, because the
 * host is the part that decides whose server gets the request: `/api/v1/events/`
 * is CTFtime's API on ctftime.org and somebody else's problem anywhere else.
 * §7.2 writes CTFtime's entries as paths because the host is obvious in prose;
 * in the database it has to be said.
 *
 * ```text
 * entry   := ["!"] host [ "/" prefix ]
 * host    := "*." domain | domain
 * prefix  := path text, with "{...}" matching exactly one segment
 * ```
 *
 * - `ctftime.org/api/v1/events/` — that host, paths starting with that prefix.
 * - `ctftime.org/api/v1/events/{id}/` — `{id}` matches one segment, no slashes.
 * - `*.devfolio.co` — any sub-domain, any path. Not `devfolio.co` itself.
 * - `!api.devfolio.co` — a **denial**, and a denial always wins. This is what
 *   keeps the Devfolio wildcard from reaching the private API the adapter is
 *   forbidden to call (D-26).
 *
 * Host comparison is case-insensitive (DNS is); the path is compared as written,
 * since a URL path is not.
 */

/** A parsed entry. Kept separate from matching so a bad entry fails loudly. */
interface AllowedPath {
  readonly deny: boolean;
  readonly host: string;
  /** True for `*.example.com`: sub-domains only, never the bare domain. */
  readonly subdomainsOnly: boolean;
  /** Undefined means "any path on this host". */
  readonly pathPattern: RegExp | undefined;
}

const SEGMENT_PLACEHOLDER = /\{[^/{}]*\}/g;

/** Escapes everything a regular expression would otherwise read as syntax. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * A path prefix becomes an anchored pattern: literal text escaped, `{...}`
 * replaced by "one or more characters that are not a slash". It is a prefix
 * match, so `/api/v1/events/` also authorizes `/api/v1/events/123/`.
 */
function compilePath(prefix: string): RegExp {
  const parts = prefix.split(SEGMENT_PLACEHOLDER).map(escapeRegExp);
  return new RegExp(`^${parts.join('[^/]+')}`);
}

function parseEntry(entry: string): AllowedPath | undefined {
  const trimmed = entry.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const deny = trimmed.startsWith('!');
  const body = deny ? trimmed.slice(1) : trimmed;
  const slash = body.indexOf('/');
  const rawHost = (slash === -1 ? body : body.slice(0, slash)).toLowerCase();
  const prefix = slash === -1 ? '' : body.slice(slash);
  if (rawHost.length === 0) {
    return undefined;
  }
  const subdomainsOnly = rawHost.startsWith('*.');
  return {
    deny,
    host: subdomainsOnly ? rawHost.slice(2) : rawHost,
    subdomainsOnly,
    pathPattern: prefix.length === 0 ? undefined : compilePath(prefix),
  };
}

/** Every entry that parses. An unparseable one authorizes nothing, silently. */
export function parseAllowedPaths(entries: readonly string[]): readonly AllowedPath[] {
  return entries.map(parseEntry).filter((entry): entry is AllowedPath => entry !== undefined);
}

function hostMatches(entry: AllowedPath, host: string): boolean {
  if (entry.subdomainsOnly) {
    return host.endsWith(`.${entry.host}`);
  }
  return host === entry.host;
}

function matches(entry: AllowedPath, host: string, path: string): boolean {
  if (!hostMatches(entry, host)) {
    return false;
  }
  return entry.pathPattern === undefined || entry.pathPattern.test(path);
}

/**
 * Is this URL inside the source's allowance?
 *
 * Deny entries are checked first and are absolute: a URL matched by a `!` entry
 * is refused however many allow entries also match it. An empty list allows
 * nothing, which is what makes a MANUAL_IMPORT_ONLY source's empty
 * `allowed_paths_json` a second, independent reason it can make no request.
 */
export function isPathAllowed(url: URL, entries: readonly string[]): boolean {
  const parsed = parseAllowedPaths(entries);
  const host = url.hostname.toLowerCase();
  const path = `${url.pathname}${url.search}`;
  if (parsed.some((entry) => entry.deny && matches(entry, host, path))) {
    return false;
  }
  return parsed.some((entry) => !entry.deny && matches(entry, host, path));
}

/**
 * Whether a host is covered by one of a list of host patterns — `example.com`
 * for that host exactly, `*.example.com` for the domain and its sub-domains.
 *
 * Used by two rules that are deliberately separate from {@link isPathAllowed}:
 * where a credential may be sent (R74: the professor's session goes to its own
 * source's hosts and nowhere else, not even robots.txt) and which source a
 * pasted link belongs to (WP-14). Both are host questions with no path in them.
 */
export function hostAllowed(host: string, patterns: readonly string[]): boolean {
  const target = host.toLowerCase();
  return patterns.some((pattern) => {
    const wanted = pattern.trim().toLowerCase();
    if (wanted.startsWith('!') || wanted.length === 0) {
      return false;
    }
    if (wanted.startsWith('*.')) {
      const base = wanted.slice(2);
      return target === base || target.endsWith(`.${base}`);
    }
    return target === wanted;
  });
}
