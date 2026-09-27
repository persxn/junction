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
  // `href` only, and only to somewhere a browser may safely go. `mailto:`
  // survives the sanitizer and is turned into text by the converter below, which
  // is the only way to keep the address without keeping the link.
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto'],
  // Text inside a dropped tag is kept; text inside these is not text.
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript'],
  disallowedTagsMode: 'discard',
};

/**
 * `<a href="mailto:cell@example.edu">Write to us</a>` becomes the address as
 * text, never a link (WP-13 Q2, answered in the M1 review).
 *
 * A scraped `mailto:` is somebody's e-mail address, and D-29 says an address
 * from a source is not stored. Keeping the link made it worse than useless: the
 * redactor runs after the conversion, so what a professor read was
 * `[[contact details…]](mailto:[contact details…])`. Reducing the link to its
 * address here — after the sanitizer, before the redactor — leaves one
 * placeholder in a sentence.
 *
 * It is a Turndown rule rather than a `transformTags` entry because
 * `sanitize-html` drops the text that follows a tag whose contents it is asked
 * to replace, so "write to <a…>x@y</a> or call …" lost the rest of the sentence.
 */
/**
 * The two bits of a DOM node the rule needs. Declared here because the backend
 * builds without the DOM library — `@types/turndown` types its nodes as
 * `HTMLElement`, which resolves to nothing in this project.
 */
interface TagNode {
  readonly nodeName: string;
  getAttribute(name: string): string | null;
}

/** The address a `mailto:` href carries, or `undefined` for any other link. */
function mailtoAddress(node: TagNode): string | undefined {
  if (node.nodeName !== 'A') {
    return undefined;
  }
  const match = /^\s*mailto:([^?]*)/i.exec(node.getAttribute('href') ?? '');
  if (match === null) {
    return undefined;
  }
  const address = match[1] ?? '';
  try {
    return decodeURIComponent(address).trim();
  } catch {
    // A malformed escape is not worth a warning; the raw text is the address.
    return address.trim();
  }
}

/**
 * The assertion is at the object, not at each node: `Rule` types its nodes as the
 * DOM `HTMLElement`, which resolves to nothing in a project built without the DOM
 * library, so every use of a node inside would otherwise be an unchecked one.
 * {@link TagNode} says what is actually touched.
 */
const MAILTO_AS_TEXT = {
  filter: (node: TagNode) => mailtoAddress(node) !== undefined,
  replacement: (content: string, node: TagNode) => {
    const address = mailtoAddress(node);
    // An empty `mailto:` is a link to nobody; the label is the better text.
    return address === undefined || address === '' ? content : address;
  },
} as unknown as TurndownService.Rule;

function turndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: 'atx',
    bulletListMarker: '-',
    codeBlockStyle: 'fenced',
    emDelimiter: '*',
  });
  // A table would otherwise come out as a run of unseparated cell text.
  service.keep(['table', 'thead', 'tbody', 'tr', 'th', 'td']);
  service.addRule('mailtoAsText', MAILTO_AS_TEXT);
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
 * Something tag-shaped: `<p`, `<br/>`, `<!-- -->`, `</div>`.
 *
 * Deliberately loose. Anything that might be markup takes the sanitizing path,
 * so the only inputs that skip it are ones with nothing tag-like in them at all.
 */
const LOOKS_LIKE_HTML = /<[a-z!/][^>]*>/i;

/**
 * HTML, Markdown or plain text → sanitized Markdown, with contact details
 * redacted.
 *
 * The two paths matter, and the Devfolio fixture is why. Turndown exists to turn
 * HTML into Markdown, and it *escapes* Markdown syntax it finds in its input so
 * that the output renders as the literal characters. That is correct for HTML —
 * a `*` in a paragraph is an asterisk — and wrong for a source like Devfolio
 * that already sends Markdown, where it turned every `**bold**` into
 * `\*\*bold\*\*` and a professor would have read the backslashes on screen.
 *
 * So: markup goes through the sanitizer and the converter; text that contains no
 * tag at all is already in the target language and is left alone. Anything
 * remotely tag-shaped takes the first path, so nothing dangerous can reach the
 * second one by looking innocent.
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

  if (!LOOKS_LIKE_HTML.test(trimmed)) {
    const markdown = tidy(trimmed);
    return markdown.length === 0 ? undefined : redact(markdown, warnings, field);
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
