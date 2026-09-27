import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { renderInRouter } from '../../../testing/render.js';
import { SourcesPage } from './SourcesPage.js';

/**
 * Admin → Sources, and the signed-in sources of R74/D-34 (WP-14 step 12).
 *
 * The rules worth a test are the ones a screenshot would not show: the cookie
 * only ever travels outward, an expired session is a state rather than an
 * error, and a source whose verdict allows no session offers no way to give it
 * one.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
const listen = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/event', () => ({ listen }));

/** Delivers the shell's `signin://finished` the way the real window would. */
function finishSignIn(sourceKey: string): void {
  for (const [name, handler] of listen.mock.calls as [
    string,
    (event: { payload: unknown }) => void,
  ][]) {
    if (name === 'signin://finished') {
      handler({ payload: { sourceKey } });
    }
  }
}

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

function source(key: string, name: string, adapter: string): Record<string, unknown> {
  return {
    id: `0192f0c1-0000-7000-8000-00000000000${key.length}`,
    key,
    name,
    adapter,
    isEnabled: true,
    complianceStatus: 'APPROVED_WITH_LIMITS',
    complianceNotes: '',
    cadenceMinutes: 15,
    manualMinIntervalMinutes: 5,
    minDelayMs: 3000,
    maxRequestsPerRun: 11,
    allowedPaths: [],
    trustRank: 60,
    attributionText: null,
    complianceReviewDueAt: null,
    version: 1,
  };
}

const SESSIONS: Readonly<Record<string, unknown>> = {
  devfolio: {
    supported: true,
    isSet: false,
    state: 'NONE',
    capturedAt: null,
    lastVerifiedAt: null,
    loginUrl: 'https://devfolio.co/login',
    hosts: ['devfolio.co', '*.devfolio.co'],
  },
  ctftime: {
    supported: false,
    isSet: false,
    state: 'NONE',
    capturedAt: null,
    lastVerifiedAt: null,
    hosts: [],
  },
};

function backend(options: { sessions?: Readonly<Record<string, unknown>> } = {}): Recorded[] {
  const calls: Recorded[] = [];
  const sessions = options.sessions ?? SESSIONS;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const method = init?.method ?? 'GET';
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as Record<string, unknown>)
          : undefined;
      calls.push({ method, path, body });
      const answer = (payload: unknown): Response =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (path === '/api/v1/sources') {
        return Promise.resolve(
          answer({
            sources: [
              source('devfolio', 'Devfolio', 'DEVFOLIO'),
              source('ctftime', 'CTFtime', 'CTFTIME_API'),
              source('manual', 'Typed in by hand', 'MANUAL'),
            ],
          }),
        );
      }
      const session = /\/admin\/sources\/([\w-]+)\/session$/.exec(path)?.[1];
      if (session !== undefined) {
        if (method === 'PUT') {
          return Promise.resolve(
            answer({ ...(sessions[session] as object), isSet: true, state: 'ACTIVE' }),
          );
        }
        if (method === 'DELETE') {
          return Promise.resolve(
            answer({ ...(sessions[session] as object), isSet: false, state: 'NONE' }),
          );
        }
        return Promise.resolve(answer(sessions[session]));
      }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
  return calls;
}

beforeEach(() => {
  resetApiTransport();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  listen.mockReset();
  listen.mockResolvedValue(() => undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Admin → Sources', () => {
  it('lists the sources that are read from the internet, and no others', async () => {
    backend();
    await renderInRouter(<SourcesPage />);
    expect(await screen.findByRole('heading', { name: 'Devfolio' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'CTFtime' })).toBeInTheDocument();
    // `manual` and `url-import` are rows an event belongs to, not sites.
    expect(screen.queryByRole('heading', { name: 'Typed in by hand' })).not.toBeInTheDocument();
  });

  it('offers no sign-in for a source whose verdict does not allow one', async () => {
    backend();
    await renderInRouter(<SourcesPage />);
    const ctftime = (await screen.findByRole('heading', { name: 'CTFtime' })).closest('article');
    expect(ctftime).toHaveTextContent('there is nothing to sign in to');
    expect(within(ctftime!).queryByRole('button')).not.toBeInTheDocument();
  });

  it('opens the packaged sign-in window from one button (pre-M2a)', async () => {
    backend();
    const user = userEvent.setup();
    await renderInRouter(<SourcesPage />);
    await user.click(await screen.findByRole('button', { name: 'Sign in to Devfolio' }));
    expect(invoke).toHaveBeenCalledWith('open_source_signin', {
      request: {
        sourceKey: 'devfolio',
        loginUrl: 'https://devfolio.co/login',
        hosts: ['devfolio.co', '*.devfolio.co'],
      },
    });
    // The second button WP-14 needed is gone; the window reports back instead.
    expect(screen.queryByRole('button', { name: 'Use this session' })).not.toBeInTheDocument();
  });

  it('stores the session when the window says it is finished, and keeps no copy', async () => {
    const calls = backend();
    invoke.mockResolvedValue({ sourceKey: 'devfolio', cookie: 'df=abc', count: 1 });
    await renderInRouter(<SourcesPage />);
    await screen.findByRole('button', { name: 'Sign in to Devfolio' });

    finishSignIn('devfolio');

    const put = await vi.waitFor(() => {
      const found = calls.find((call) => call.method === 'PUT');
      expect(found).toBeDefined();
      return found;
    });
    expect(put?.body).toEqual({ cookie: 'df=abc', capturedVia: 'LOGIN_WINDOW' });
    // The cookie is nowhere on the screen, before or after.
    expect(document.body.textContent).not.toContain('df=abc');
  });

  it('says nothing was stored when the window is closed before signing in', async () => {
    const calls = backend();
    invoke.mockResolvedValue({ sourceKey: 'devfolio', cookie: '', count: 0 });
    await renderInRouter(<SourcesPage />);
    await screen.findByRole('button', { name: 'Sign in to Devfolio' });

    finishSignIn('devfolio');

    expect(await screen.findByText(/The window closed before you were signed in/)).toBeVisible();
    expect(calls.find((call) => call.method === 'PUT')).toBeUndefined();
  });

  it('ignores a finished event for a different source', async () => {
    const calls = backend();
    invoke.mockResolvedValue({ sourceKey: 'unstop', cookie: 'un=abc', count: 1 });
    await renderInRouter(<SourcesPage />);
    await screen.findByRole('button', { name: 'Sign in to Devfolio' });

    finishSignIn('unstop');

    await vi.waitFor(() => {
      expect(calls.find((call) => call.method === 'PUT')).toBeUndefined();
    });
  });

  it('takes a pasted cookie and never shows it back', async () => {
    const calls = backend();
    const user = userEvent.setup();
    await renderInRouter(<SourcesPage />);
    await user.click(await screen.findByRole('button', { name: 'Paste session' }));
    await user.type(screen.getByLabelText('Cookie header from your browser'), 'df=pasted');
    await user.click(screen.getByRole('button', { name: 'Save session' }));

    const put = await vi.waitFor(() => {
      const found = calls.find((call) => call.method === 'PUT');
      expect(found).toBeDefined();
      return found;
    });
    expect(put?.body).toEqual({ cookie: 'df=pasted', capturedVia: 'PASTE' });
  });

  it('shows a session this machine cannot open as a state too (ruling R76)', async () => {
    backend({
      sessions: {
        ...SESSIONS,
        devfolio: { ...(SESSIONS.devfolio as object), isSet: true, state: 'UNAVAILABLE' },
      },
    });
    await renderInRouter(<SourcesPage />);
    expect(await screen.findByText(/cannot be opened on this machine/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await expect(document.body).toBeAccessible();
  });

  it('shows an expired session as a state of the source, not as an error', async () => {
    backend({
      sessions: {
        ...SESSIONS,
        devfolio: { ...(SESSIONS.devfolio as object), isSet: true, state: 'EXPIRED' },
      },
    });
    await renderInRouter(<SourcesPage />);
    expect(await screen.findByText(/Your Devfolio session expired/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    await expect(document.body).toBeAccessible();
  });
});
