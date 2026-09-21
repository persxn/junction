import { AppError } from '../../../platform/errors.js';

/**
 * The `IMPORT_` problems URL import raises (R12, R5, WP-14).
 *
 * Each one is a different screen, which is why they are not one code: "that is
 * not a link", "we are not allowed to read that site", "that site says no", "we
 * read it and it said nothing useful" and "that was a PDF" ask the professor for
 * five different things. Every one of them ends in the same place — the manual
 * form, with the link attached — so each carries the hint that says so.
 */

export const importUrlInvalid = (detail: string): AppError =>
  new AppError({
    code: 'IMPORT_URL_INVALID',
    status: 400,
    title: 'That link cannot be imported',
    detail,
    hint: 'Paste the https:// address of the event page, or add the event by hand.',
    retryable: false,
  });

/**
 * D-30: the domain belongs to a source whose Terms say no (Devpost), so nothing
 * was requested — not the page, not even its robots.txt.
 *
 * A 200 would be wrong (nothing was imported) and a 403 would be wrong too
 * (nobody refused *us*). 409 says: the request is fine, the state of the world
 * makes it impossible, and here is what to do instead.
 */
export const importDomainManualOnly = (detail: string): AppError =>
  new AppError({
    code: 'IMPORT_DOMAIN_MANUAL_ONLY',
    status: 409,
    title: 'That site is not read automatically',
    detail,
    hint: 'Type the details in — the link is saved with the event.',
    retryable: false,
  });

export const importRobotsDisallowed = (host: string): AppError =>
  new AppError({
    code: 'IMPORT_ROBOTS_DISALLOWED',
    status: 409,
    title: 'That page asks not to be read automatically',
    detail: `${host}'s robots.txt disallows this page, so it was not fetched.`,
    hint: 'Type the details in — the link is saved with the event.',
    retryable: false,
  });

export const importUnsupportedContent = (contentType: string | undefined): AppError =>
  new AppError({
    code: 'IMPORT_UNSUPPORTED_CONTENT',
    status: 415,
    title: 'That link is not a web page',
    detail:
      contentType === undefined
        ? 'The link did not answer with HTML, so there was nothing to read.'
        : `The link answered with ${contentType}, and only HTML pages can be read.`,
    hint: 'Paste the event page instead of a file, or type the details in.',
    retryable: false,
  });

export const importExtractionFailed = (url: string): AppError =>
  new AppError({
    code: 'IMPORT_EXTRACTION_FAILED',
    status: 422,
    title: 'Nothing could be read from that page',
    detail: `${url} was read, but it carries no event details this can recognise.`,
    hint: 'Type the details in — the link is saved with the event.',
    retryable: false,
  });

/** The page could not be fetched at all: DNS, TLS, a timeout, a 500, a 403. */
export const importUnreachable = (url: string, why: string): AppError =>
  new AppError({
    code: 'SOURCE_UNREACHABLE',
    status: 502,
    title: 'That page could not be read',
    detail: `${url} could not be fetched: ${why}`,
    hint: 'Try again, or type the details in.',
    retryable: true,
  });

/**
 * The preview limit. It exists because §7.1 calls URL import *user-initiated*:
 * ten pages a minute is more than a person reviewing each one can use, and it
 * is the ceiling that keeps a stuck UI from becoming a crawler.
 */
export const importRateLimited = (perMinute: number): AppError =>
  new AppError({
    code: 'IMPORT_RATE_LIMITED',
    status: 429,
    title: 'Too many imports at once',
    detail: `URL import reads at most ${String(perMinute)} pages a minute, so each one is a page somebody asked for.`,
    hint: 'Wait a moment and try again.',
    retryable: true,
  });
