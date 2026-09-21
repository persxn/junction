import type { ScrapeErrorKind } from '@compintel/contracts';

import type { GateRefusal } from '../domain/scraping/gate.js';
import { ScrapeRequestError, TransportError } from './http/index.js';

/**
 * How a run ends badly, in the two vocabularies §7.7 needs: the `error_kind`
 * column and whether we were the ones who said no.
 */

/**
 * What an adapter throws when a source's shape is not what it used to be.
 *
 * `SCHEMA_CHANGED` and `PARSE` both pause the source until an administrator
 * re-enables it (§7.7), and the difference between them is only what an admin is
 * told: `SCHEMA_CHANGED` is "the fields we rely on are gone", `PARSE` is "this is
 * not the document we expected at all". An adapter that cannot tell should say
 * `PARSE`.
 *
 * A format error is thrown **before any item is yielded**. That is the contract
 * that makes §19's "no partial writes" true: items are written one transaction
 * at a time, so the only way a format failure can leave nothing behind is for it
 * to be raised while the listing is still being read.
 */
export class AdapterFormatError extends Error {
  readonly kind: Extract<ScrapeErrorKind, 'PARSE' | 'SCHEMA_CHANGED'>;
  /**
   * The body that did not parse. The orchestrator keeps it as a §7.8 snapshot,
   * because the bytes that broke an adapter are what its fixture is regenerated
   * from.
   */
  readonly raw: Uint8Array | undefined;

  constructor(
    kind: Extract<ScrapeErrorKind, 'PARSE' | 'SCHEMA_CHANGED'>,
    message: string,
    cause?: unknown,
    raw?: Uint8Array,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'AdapterFormatError';
    this.kind = kind;
    this.raw = raw;
  }
}

/** Why a run stopped, in the shape `scrape_runs` stores. */
export interface RunFailure {
  readonly kind: ScrapeErrorKind;
  readonly message: string;
  /** Set when the compliance gate refused; the outcome is then BLOCKED_BY_POLICY. */
  readonly refusal: GateRefusal | undefined;
  /** True for PARSE/SCHEMA_CHANGED, which switch the source off (§7.7). */
  readonly pausesSource: boolean;
}

/** Kinds that pause a source rather than backing it off. */
export function pausesSource(kind: ScrapeErrorKind): boolean {
  return kind === 'PARSE' || kind === 'SCHEMA_CHANGED';
}

/**
 * Classifies whatever a run threw.
 *
 * An unexpected error — a bug in an adapter, a null dereference — becomes
 * `UNKNOWN` rather than being allowed to look like a network problem. It is
 * still a failed run, but an admin reading Source status can tell "their server
 * is down" from "our code threw".
 */
export function toRunFailure(error: unknown): RunFailure {
  if (error instanceof ScrapeRequestError) {
    return {
      kind: error.kind,
      message: error.message,
      refusal: error.refusal,
      pausesSource: false,
    };
  }
  if (error instanceof AdapterFormatError) {
    return { kind: error.kind, message: error.message, refusal: undefined, pausesSource: true };
  }
  // An adapter that reached the network some other way — a `node:zlib` stream, a
  // file read — still gets its failure classified rather than flattened.
  if (error instanceof TransportError) {
    return { kind: error.kind, message: error.message, refusal: undefined, pausesSource: false };
  }
  return {
    kind: 'UNKNOWN',
    message: error instanceof Error ? error.message : String(error),
    refusal: undefined,
    pausesSource: false,
  };
}
