/**
 * Opening a link that is not ours (§13 "Opening safely").
 *
 * Two rules, both of them the spec's. **http/https only** — §13 fixes the URL
 * kinds, and anything else (a `file:`, a `javascript:`, a custom scheme) is a
 * stored string being allowed to do something, which §13 exists to prevent.
 * And **never in the WebView**: the app must not navigate away from itself, so
 * the link is handed to a new context and the caller is told whether that
 * worked.
 */

export function isExternalUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Hands an http/https URL to the browser. `false` means it was refused (not a
 * web URL) or the environment blocked the hand-off, and the caller says so
 * rather than leaving a button that appears to do nothing.
 */
export function openExternal(url: string): boolean {
  if (!isExternalUrl(url)) {
    return false;
  }
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  return opened !== null;
}
