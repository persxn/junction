import { createHash } from 'node:crypto';
import { Readable, type Transform } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';

import type { ScrapeMethod } from '@compintel/contracts';

import { hostAllowed } from '../../domain/scraping/paths.js';
import type { ValidatorStore } from './cache.js';
import { asTransportError } from './classify.js';
import {
  MAX_RESPONSE_BYTES,
  ScrapeRequestError,
  TransportError,
  type PoliteResponse,
  type SourceCredential,
  type TransportResponse,
} from './types.js';

/**
 * Reading a response body without ever holding more than the cap (§4.8's 5 MB).
 *
 * The cap is checked *before* each chunk is kept, and the iterator's `return()`
 * is called the moment it is exceeded, which is what tells undici to destroy the
 * socket. A version that concatenated first and measured afterwards would have
 * the same error message and none of the protection, so the test asserts on how
 * many chunks the fake transport was asked for, not on the error.
 */
export interface ReadResult {
  readonly body: Uint8Array;
  /** SHA-256 hex of the bytes, computed while reading rather than after. */
  readonly contentHash: string;
}

/**
 * The decoder for a `Content-Encoding`, or `undefined` for an identity body.
 *
 * Every request says `Accept-Encoding: gzip, deflate`, and undici's `request()`
 * hands the body back exactly as it came off the wire. Before this existed a
 * compressed answer reached the adapters as gzip bytes, CTFtime's JSON failed to
 * parse, and the source paused itself as SCHEMA_CHANGED on its first live run.
 */
function decoderFor(response: TransportResponse): Transform | undefined {
  const encoding = (response.headers['content-encoding'] ?? '').trim().toLowerCase();
  switch (encoding) {
    case '':
    case 'identity':
      return undefined;
    case 'gzip':
    case 'x-gzip':
      return createGunzip();
    case 'deflate':
      return createInflate();
    case 'br':
      return createBrotliDecompress();
    default:
      throw new TransportError(
        'UNKNOWN',
        `The response uses an unsupported Content-Encoding (${encoding}).`,
      );
  }
}

/** zlib's codes are `Z_DATA_ERROR` and friends; Brotli's start `ERR__` or name it. */
function isZlibError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return (
    typeof code === 'string' &&
    (code.startsWith('Z_') || code.startsWith('ERR__') || code.includes('BROTLI'))
  );
}

/**
 * The cap is on the **decoded** bytes, so a small compressed body that inflates
 * past it is abandoned part-way like any other oversized answer.
 */
export async function readCapped(
  response: TransportResponse,
  maxBytes: number,
): Promise<ReadResult> {
  const chunks: Uint8Array[] = [];
  const hash = createHash('sha256');
  let total = 0;
  const decoder = decoderFor(response);
  const wire = decoder === undefined ? undefined : Readable.from(response.body);
  const iterator: AsyncIterator<Uint8Array> =
    wire === undefined || decoder === undefined
      ? response.body[Symbol.asyncIterator]()
      : wire.pipe(decoder)[Symbol.asyncIterator]();
  try {
    for (;;) {
      const next = await iterator.next();
      if (next.done === true) {
        break;
      }
      const chunk = next.value;
      total += chunk.byteLength;
      if (total > maxBytes) {
        // Not NETWORK: nothing went wrong on the wire, and a retry would only
        // pull the same oversized body again. UNKNOWN is the honest kind for
        // "we stopped this on purpose", and it is not retried.
        throw new TransportError(
          'UNKNOWN',
          `The response is larger than the ${maxBytes}-byte cap, so it was abandoned.`,
        );
      }
      hash.update(chunk);
      chunks.push(chunk);
    }
  } catch (error) {
    // A corrupt compressed body is the server's fault, not the network's.
    if (error instanceof TransportError) {
      throw error;
    }
    if (decoder !== undefined && isZlibError(error)) {
      throw new TransportError('UNKNOWN', 'The compressed response could not be decoded.');
    }
    throw error;
  } finally {
    // Destroys the socket when we stopped early; a no-op when we did not.
    await iterator.return?.();
    wire?.destroy();
    decoder?.destroy();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body, contentHash: hash.digest('hex') };
}

/** One source of truth for turning a body into text; UTF-8, always. */
export function decode(body: Uint8Array): string {
  return new TextDecoder('utf-8').decode(body);
}

/** Header lookup by a name the linter would rather see in dot notation. */
export function header(response: TransportResponse, name: string): string | undefined {
  return response.headers[name];
}

/** Adds the two lazy accessors and freezes the result. */
export function frozen(base: Omit<PoliteResponse, 'text' | 'json'>): PoliteResponse {
  return Object.freeze({
    ...base,
    text: () => decode(base.body),
    json: () => JSON.parse(decode(base.body)) as unknown,
  });
}

export interface RequestHeaderInput {
  readonly host: string;
  readonly userAgent: string;
  readonly accept?: string | undefined;
  /** The source's documented API key (WP-11); sent on every request to it. */
  readonly credential?: SourceCredential | undefined;
  /** The professor's session, only when R75 granted this request `signed-in`. */
  readonly session?: SourceCredential | undefined;
  readonly conditional?: { etag?: string | null; lastModified?: string | null } | undefined;
}

export interface RequestHeaders {
  readonly headers: Record<string, string>;
  /** True when the professor's session (R74) was attached. */
  readonly sentSession: boolean;
  /** True when the source's API key was attached (R80 needs to know). */
  readonly sentCredential: boolean;
}

/** Whether a credential may go to this host: its own hosts, or any when it names none. */
function mayCarry(credential: SourceCredential | undefined, host: string): boolean {
  if (credential === undefined) {
    return false;
  }
  return credential.hosts === undefined || hostAllowed(host, credential.hosts);
}

/**
 * The headers one request carries. Pure, so "was the cookie sent to this host?"
 * is answerable without a transport.
 *
 * A credential goes on the source's own requests only — never on robots.txt,
 * which the robots cache fetches with no source context — and is never logged.
 * A credential that names its hosts (the professor's session, R74) is sent to
 * those and to nothing else, even where the path allowlist would have permitted
 * the request without one. The session is additionally only ever passed in for
 * a request R75 granted `signed-in`; an anonymous request never sees it.
 */
export function requestHeaders(input: RequestHeaderInput): RequestHeaders {
  const headers: Record<string, string> = {
    'user-agent': input.userAgent,
    accept: input.accept ?? 'application/json, text/html;q=0.9, */*;q=0.5',
    'accept-encoding': 'gzip, deflate',
  };
  const sentCredential = mayCarry(input.credential, input.host);
  if (sentCredential && input.credential !== undefined) {
    headers[input.credential.header.toLowerCase()] = input.credential.value;
  }
  const sentSession = input.session?.hosts !== undefined && mayCarry(input.session, input.host);
  if (sentSession && input.session !== undefined) {
    headers[input.session.header.toLowerCase()] = input.session.value;
  }
  if (input.conditional?.etag != null) {
    headers['if-none-match'] = input.conditional.etag;
  }
  if (input.conditional?.lastModified != null) {
    headers['if-modified-since'] = input.conditional.lastModified;
  }
  return { headers, sentSession, sentCredential };
}

/** A 304: nothing to read, and the cached validators are still good (R58). */
export function notModifiedResponse(
  cache: ValidatorStore | undefined,
  response: TransportResponse,
  target: string,
  now: Date,
): PoliteResponse {
  cache?.touch(target, now.getTime());
  return frozen({
    status: 304,
    url: target,
    headers: response.headers,
    body: new Uint8Array(0),
    notModified: true,
    contentHash: '',
  });
}

/**
 * A 2xx/3xx body, read under §4.8's cap and hashed, with its validators kept
 * for the next conditional GET (R58).
 */
export async function storedResponse(
  cache: ValidatorStore | undefined,
  response: TransportResponse,
  target: string,
  method: ScrapeMethod,
  now: Date,
): Promise<PoliteResponse> {
  const { body, contentHash } = await readCapped(response, MAX_RESPONSE_BYTES).catch(
    (error: unknown) => {
      const transport = asTransportError(error);
      throw new ScrapeRequestError({
        kind: transport.kind,
        message: `${method} ${target} failed while reading: ${transport.message}`,
        cause: error,
      });
    },
  );
  cache?.put(
    target,
    { etag: header(response, 'etag'), lastModified: header(response, 'last-modified') },
    contentHash,
    now.getTime(),
  );
  return frozen({
    status: response.status,
    url: response.url,
    headers: response.headers,
    body,
    notModified: false,
    contentHash,
  });
}
