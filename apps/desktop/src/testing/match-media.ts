/**
 * A controllable `window.matchMedia` for jsdom, which has none.
 *
 * It is a real implementation rather than a stub returning `false`: the theme
 * has to react to Windows changing its colour scheme while the app is open, and
 * that path is only testable if the fake can fire `change` events.
 */

type Listener = (event: MediaQueryListEvent) => void;

interface FakeQuery extends MediaQueryList {
  readonly listeners: Set<Listener>;
}

const queries = new Map<string, FakeQuery>();
let matching = new Set<string>();

function makeQuery(media: string): FakeQuery {
  const listeners = new Set<Listener>();
  const query = {
    media,
    get matches(): boolean {
      return matching.has(media);
    },
    listeners,
    onchange: null,
    addEventListener: (_type: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_type: string, listener: Listener) => listeners.delete(listener),
    addListener: (listener: Listener) => listeners.add(listener),
    removeListener: (listener: Listener) => listeners.delete(listener),
    dispatchEvent: () => true,
  };
  return query as unknown as FakeQuery;
}

function install(): void {
  if (typeof globalThis.matchMedia === 'function' && queries.size > 0) {
    return;
  }
  globalThis.matchMedia = (media: string): MediaQueryList => {
    const existing = queries.get(media);
    if (existing !== undefined) {
      return existing;
    }
    const created = makeQuery(media);
    queries.set(media, created);
    return created;
  };
}

/** Sets which media queries currently match, and notifies every listener. */
export function setMatchingMedia(media: readonly string[]): void {
  install();
  matching = new Set(media);
  for (const [key, query] of queries) {
    for (const listener of query.listeners) {
      listener({ matches: matching.has(key), media: key } as MediaQueryListEvent);
    }
  }
}

/** The common case: what Windows is set to. */
export function setSystemTheme(theme: 'light' | 'dark'): void {
  setMatchingMedia(theme === 'dark' ? ['(prefers-color-scheme: dark)'] : []);
}
