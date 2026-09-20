import sanitizeHtml from 'sanitize-html';
import TurndownService from 'turndown';

import { redact } from './redact.js';
import type { WarningCollector } from './warnings.js';

/**
 * Description text: HTML in, sanitized Markdown out (§7.3).
 *
 * "No raw HTML stored" is the rule, and it is a storage rule rather than a
 * rendering one: the UI renders Markdown, an AI summary reads Markdown, and a
 * backup is Markdown. If raw HTML were stored, every one of those would have to
 * be trusted to sanitize, and one of them eventually would not.
 *
 * Two passes, in this order. `sanitize-html` first, with an allowlist, because
 * it is the thing that actually decides what is permitted — scripts, styles,
 * iframes, event handlers and `javascript:` URLs never reach the second pass.
 * Then Turndown converts what survived. Doing it the other way round would mean
 * converting markup we had not yet agreed to accept.
 */

/**
 * What a competition description legitimately needs: structure, emphasis, lists,
 * links, tables. Not images (they would be hotlinks to a source we do not
 * control), not media, not anything that executes.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'code',
  'pre',
  'hr',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
];

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ALLOWED_TAGS,
  // `href` only, and only to somewhere a browser may safely go.
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Text inside a dropped tag is kept; text inside these is not text.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  disallowedTagsMode: 'discard',
};

function turndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  // A table would otherwise come out as a run of unseparated cell text.
  service.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
  return service;
}

/** Collapses the runs of blank lines Turndown leaves behind. */
function tidy(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * HTML (or plain text) → sanitized Markdown, with contact details redacted.
 *
 * Returns `undefined` for input that holds no text at all, so an empty
 * description is an absent field rather than an empty string.
 */
export function toMarkdown(
  input: string,
  warnings?: WarningCollector,
  field = 'descriptionMd',
): string | undefined {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return undefined;
  }
  const clean = sanitizeHtml(trimmed, SANITIZE_OPTIONS);
  if (clean.replace(/\s+/g, '') !== trimmed.replace(/\s+/g, '')) {
    warnings?.add('HTML_SANITIZED', 'Disallowed markup was removed from the description.', field);
  }
  const markdown = tidy(turndown().turndown(clean));
  if (markdown.length === 0) {
    return undefined;
  }
  return redact(markdown, warnings, field);
}

/** Tags after which text must not run into the next block's text. */
const BLOCK_BOUNDARY =
  /<\/?(?:p|div|br|li|ul|ol|tr|td|th|h[1-6]|blockquote|pre|hr|section|article)\b[^>]*>/gi;

/**
 * Markdown (or HTML) reduced to the words, for the summary and for search.
 *
 * Block tags become a space *before* the markup is stripped. Without that,
 * `<h2>Rules</h2><p>Be nice.</p>` collapses to "RulesBe nice." — which reads as
 * corrupted data in a feed and, worse, breaks the word the search index needs.
 */
export function toPlainText(input: string): string {
  const spaced = input.replace(BLOCK_BOUNDARY, ' ');
  const withoutHtml = sanitizeHtml(spaced, { allowedTags: [], allowedAttributes: {} });
  return (
    withoutHtml
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, ' ')
      // Markdown syntax that survived: links, emphasis, headings, list markers.
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/^[#>\s]*/gm, '')
      .replace(/^[-*+]\s+/gm, '')
      .replace(/[*_`]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** §6.2: `summary` is plain text, at most 500 characters. */
export const SUMMARY_MAX_LENGTH = 500;

/**
 * The first {@link SUMMARY_MAX_LENGTH} characters of the description as plain
 * text, cut on a word boundary and ellipsized.
 *
 * A mid-word cut looks like corrupted data in a feed, which is exactly the
 * impression a tool like this cannot afford to give.
 */
export function toSummary(
  input: string,
  warnings?: WarningCollector,
  maxLength = SUMMARY_MAX_LENGTH,
): string | undefined {
  const plain = redact(toPlainText(input), warnings, 'summary');
  if (plain.length === 0) {
    return undefined;
  }
  if (plain.length <= maxLength) {
    return plain;
  }
  // One character of headroom for the ellipsis.
  const window = plain.slice(0, maxLength - 1);
  const lastSpace = window.lastIndexOf(' ');
  const cut = lastSpace > maxLength * 0.5 ? window.slice(0, lastSpace) : window;
  return `${cut.replace(/[\s,;:.]+$/, '')}…`;
}

/**
 * The dedup and lookup key for a title (§6.2 `normalized_title`): case-folded,
 * accent-stripped, punctuation removed, whitespace collapsed.
 *
 * "HackX 2026 — IIT Bombay" and "hackx 2026 - iit bombay" have to be the same
 * string, or WP-10 finds no candidates to compare in the first place.
 */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whitespace tidied, nothing else changed — for a title as it will be shown. */
export function cleanTitle(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}
