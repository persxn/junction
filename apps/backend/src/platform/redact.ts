/** What a redacted value is replaced with in the logs. */
export const REDACTED = '[redacted]';

/**
 * Keys whose values never reach a log file: the two auth headers named in
 * ADR-0017 plus the credential and personal-data families listed in
 * ARCHITECTURE.md 4.14. Matched case-insensitively anywhere in the key, so
 * `clientSecret`, `X-CompIntel-Client` and `contactEmail` are all covered.
 */
export const SENSITIVE_KEY_PATTERN =
  /(pass(?:word|wd|phrase)|secret|token|api[-_]?key|api[-_]?username|credential|authorization|e?mail|phone|mobile|x-compintel-client)/i;

const MAX_DEPTH = 8;

function isPlainish(value: object): boolean {
  return !(value instanceof Date) && !ArrayBuffer.isView(value) && !(value instanceof RegExp);
}

function walk(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (depth >= MAX_DEPTH || seen.has(value)) {
    return value;
  }
  if (!isPlainish(value)) {
    return value;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => walk(item, seen, depth + 1));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : walk(item, seen, depth + 1);
  }
  return out;
}

/**
 * Returns a copy of `value` with every sensitive key replaced by {@link REDACTED}.
 * Used as pino's `formatters.log`, which sees the merged object of every log
 * call, so redaction is deep and does not depend on listing paths up front.
 */
export function redactDeep(value: Record<string, unknown>): Record<string, unknown> {
  return walk(value, new WeakSet<object>(), 0) as Record<string, unknown>;
}
