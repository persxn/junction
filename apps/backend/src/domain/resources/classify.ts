import { RESOURCE_LABEL_MAX, RESOURCE_URI_MAX, type ResourceKind } from '@compintel/contracts';

/**
 * What a pasted link or path is (§13, ruling R103, WP-20b) — pure, and shape
 * only: nothing here touches the filesystem or the network. A link must be
 * http or https; GitHub is normalized to `https://github.com/<owner>/<repo>…`;
 * the cloud-document hosts are a fixed list; a local path must be absolute
 * (a drive letter or `\\server\share`). The person may pick another kind if
 * the text fits it. Whether a path may be *opened* is the shell's question
 * (R102), not this one.
 */

export type ClassifyRefusal = 'EMPTY' | 'TOO_LONG' | 'SCHEME' | 'MALFORMED' | 'RELATIVE' | 'KIND';

export const CLASSIFY_REFUSAL_TEXT: Readonly<Record<ClassifyRefusal, string>> = {
  EMPTY: 'Paste a link or a path.',
  TOO_LONG: `That is longer than ${String(RESOURCE_URI_MAX)} characters.`,
  SCHEME: 'Only web links (http or https) and paths on a PC can be added.',
  MALFORMED: 'That is not a link CompIntel can use.',
  RELATIVE: 'A path must be complete: start it with a drive letter or \\\\server\\share.',
  KIND: 'That link or path is not of the kind chosen.',
};

export type Classified =
  | { readonly ok: true; readonly kind: ResourceKind; readonly uri: string }
  | { readonly ok: false; readonly refusal: ClassifyRefusal };

const CLOUD_HOSTS = ['docs.google.com', 'drive.google.com', 'onedrive.live.com', '1drv.ms'];

const isCloudHost = (host: string): boolean =>
  CLOUD_HOSTS.includes(host) || host === 'sharepoint.com' || host.endsWith('.sharepoint.com');

const isGitHubHost = (host: string): boolean => host === 'github.com' || host === 'www.github.com';

/** A drive-letter path (`C:\…`, `C:/…`) or a UNC path (`\\server\share…`). */
const DRIVE = /^[A-Za-z]:[\\/]/;
const UNC = /^[\\/]{2}[^\\/]+[\\/][^\\/]+/;
/** A URI scheme: letters first. A single letter followed by `:` is a drive, not a scheme. */
const SCHEME = /^([A-Za-z][A-Za-z0-9+.-]+):/;

/** `https://github.com/owner/repo[/…]`, without `.git`, a trailing slash, a query or a fragment. */
function normalizeGitHub(url: URL): string | undefined {
  const parts = url.pathname.split('/').filter((part) => part !== '');
  const [owner, repo, ...rest] = parts;
  if (owner === undefined || repo === undefined) return undefined;
  const name = repo.replace(/\.git$/i, '');
  if (name === '') return undefined;
  return ['https://github.com', owner, name, ...rest].join('/');
}

/** An http or https URL with a host and no credentials, or why not. */
function parseHttp(text: string): URL | ClassifyRefusal {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return 'MALFORMED';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'SCHEME';
  if (url.hostname === '' || url.username !== '' || url.password !== '') return 'MALFORMED';
  return url;
}

function classifyUrl(text: string): Classified {
  const url = parseHttp(text);
  if (typeof url === 'string') return { ok: false, refusal: url };
  const host = url.hostname.toLowerCase();
  if (isGitHubHost(host)) {
    const normalized = normalizeGitHub(url);
    if (normalized !== undefined) return { ok: true, kind: 'GITHUB', uri: normalized };
  }
  if (isCloudHost(host)) return { ok: true, kind: 'CLOUD_DOC', uri: url.href };
  return { ok: true, kind: 'URL', uri: url.href };
}

/** The text's own kind, or a refusal. */
export function detect(input: string): Classified {
  const text = input.trim();
  if (text === '') return { ok: false, refusal: 'EMPTY' };
  if (text.length > RESOURCE_URI_MAX) return { ok: false, refusal: 'TOO_LONG' };
  if (DRIVE.test(text) || UNC.test(text)) {
    // One separator throughout, as Explorer writes it.
    return { ok: true, kind: 'LOCAL_PATH', uri: text.replace(/\//g, '\\') };
  }
  const scheme = SCHEME.exec(text)?.[1]?.toLowerCase();
  if (scheme !== undefined) {
    return scheme === 'http' || scheme === 'https'
      ? classifyUrl(text)
      : { ok: false, refusal: 'SCHEME' };
  }
  return { ok: false, refusal: 'RELATIVE' };
}

/**
 * The text as the kind the person chose. A web link may be filed as URL or
 * OTHER whatever its host; GITHUB and CLOUD_DOC need their hosts; LOCAL_PATH
 * needs a path.
 */
export function classify(input: string, requested?: ResourceKind): Classified {
  const detected = detect(input);
  if (!detected.ok || requested === undefined || requested === detected.kind) return detected;
  const isLink = detected.kind !== 'LOCAL_PATH';
  if ((requested === 'URL' || requested === 'OTHER') && isLink) {
    // Filed as a plain link: keep the text as given, not the GitHub form.
    const url = parseHttp(input.trim());
    return typeof url === 'string'
      ? { ok: false, refusal: url }
      : { ok: true, kind: requested, uri: url.href };
  }
  return { ok: false, refusal: 'KIND' };
}

const clip = (text: string): string =>
  text.length <= RESOURCE_LABEL_MAX ? text : `${text.slice(0, RESOURCE_LABEL_MAX - 1)}…`;

/** A label when none was given: `owner/repo`, the host and path, or the file name. */
export function defaultLabel(kind: ResourceKind, uri: string): string {
  if (kind === 'LOCAL_PATH') {
    const parts = uri.split('\\').filter((part) => part !== '');
    return clip(parts.at(-1) ?? uri);
  }
  try {
    const url = new URL(uri);
    if (kind === 'GITHUB')
      return clip(url.pathname.split('/').filter(Boolean).slice(0, 2).join('/'));
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '');
    return clip(`${url.hostname}${path}`);
  } catch {
    return clip(uri);
  }
}
