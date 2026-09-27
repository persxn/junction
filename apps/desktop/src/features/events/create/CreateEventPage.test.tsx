import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { renderWithProviders } from '../../../testing/render.js';
import { CreateEventPage } from './CreateEventPage.js';

/**
 * Add an event / import from a link (WP-14 step 8).
 *
 * The cases here are the ones a professor meets: a blank form that will not
 * save until it can be found again, an import that fills the form in and says
 * where each value came from, a Devpost link that is a banner rather than an
 * error, and a refusal rendered as something to do instead of a code.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

interface Recorded {
  readonly method: string;
  readonly path: string;
  readonly body: Record<string, unknown> | undefined;
}

const GENERIC_PREVIEW = {
  disposition: 'GENERIC',
  url: 'https://fest.example.ac.in/techfest-2026',
  candidate: undefined,
  fieldsFound: [
    {
      field: 'title',
      label: 'Title',
      value: 'TechFest 2026 — Coding Contest',
      confidence: 0.8,
      origin: 'OPEN_GRAPH',
    },
    {
      field: 'startsAt',
      label: 'Starts',
      value: '12 December 2026',
      confidence: 0.5,
      origin: 'HEURISTIC',
      raw: '12 December 2026',
    },
  ],
  fieldsMissing: ['Place', 'Ends'],
  warnings: [],
};

const MANUAL_ONLY_PREVIEW = {
  disposition: 'MANUAL_ONLY',
  url: 'https://devpost.com/software/codestorm',
  sourceKey: 'devpost',
  sourceName: 'Devpost',
  reason:
    "Devpost doesn't allow automated reading, so type the details in. The link is saved with the event.",
  fieldsFound: [],
  fieldsMissing: ['Title', 'Starts'],
  warnings: [],
};

function backend(options: { preview?: unknown; previewStatus?: number } = {}): Recorded[] {
  const calls: Recorded[] = [];
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

      const answer = (status: number, payload: unknown): Response =>
        new Response(JSON.stringify(payload), {
          status,
          headers: {
            'content-type': status >= 400 ? 'application/problem+json' : 'application/json',
          },
        });

      if (path === '/api/v1/events/import/preview') {
        if (options.previewStatus !== undefined) {
          return Promise.resolve(
            answer(options.previewStatus, {
              type: 'urn:compintel:problem:IMPORT_ROBOTS_DISALLOWED',
              title: 'That page asks not to be read automatically',
              status: options.previewStatus,
              code: 'IMPORT_ROBOTS_DISALLOWED',
              requestId: 'r-1',
              detail: "fest.example.ac.in's robots.txt disallows this page, so it was not fetched.",
              hint: 'Type the details in — the link is saved with the event.',
            }),
          );
        }
        return Promise.resolve(answer(200, options.preview ?? GENERIC_PREVIEW));
      }
      if (path === '/api/v1/events' || path === '/api/v1/events/import/commit') {
        return Promise.resolve(
          answer(200, {
            eventId: '0192f0c1-0000-7000-8000-00000000000a',
            created: true,
            sourceKey: path.endsWith('commit') ? 'url-import' : 'manual',
            overriddenFields: ['title'],
            warnings: [],
          }),
        );
      }
      return Promise.resolve(answer(404, { code: 'NOT_FOUND' }));
    }),
  );
  return calls;
}

beforeEach(() => {
  resetApiTransport();
  invoke.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adding an event by hand', () => {
  it('will not save until the event can be found again', async () => {
    backend();
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Add event' }));

    const save = screen.getByRole('button', { name: 'Save event' });
    expect(save).toBeDisabled();
    expect(screen.getByText('An event needs a title.')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Title'), 'Department Ideathon 2026');
    expect(save).toBeDisabled();
    expect(
      screen.getByText('Add a date or a link, so the event can be found again.'),
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Official link'), 'https://cse.example.edu/ideathon');
    expect(save).toBeEnabled();
  });

  it('says what is wrong with a link instead of refusing silently', async () => {
    backend();
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    await user.type(screen.getByLabelText('Title'), 'Ideathon');
    await user.type(screen.getByLabelText('Official link'), 'not-a-link');
    expect(screen.getByText('That does not look like a link.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save event' })).toBeDisabled();
  });

  it('posts what was typed and nothing that was left blank', async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Add event' }));
    await user.type(screen.getByLabelText('Title'), 'Department Ideathon 2026');
    await user.type(screen.getByLabelText('Official link'), 'https://cse.example.edu/ideathon');
    await user.click(screen.getByRole('button', { name: 'Save event' }));

    await screen.findByText('Saved as a new event.');
    const post = calls.find((call) => call.path === '/api/v1/events');
    expect(post?.body).toEqual({
      title: 'Department Ideathon 2026',
      officialUrl: 'https://cse.example.edu/ideathon',
    });
  });

  it('is usable with the keyboard alone and has no axe violations', async () => {
    backend();
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Add event' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Title')).toBeInTheDocument();
    await expect(document.body).toBeAccessible();
  });
});

describe('importing from a link', () => {
  it('lists what was found and what was not, then fills the form in', async () => {
    backend();
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Import from a link' }));
    await user.type(
      screen.getByLabelText('Event page'),
      'https://fest.example.ac.in/techfest-2026',
    );
    await user.click(screen.getByRole('button', { name: 'Read the page' }));

    expect(await screen.findByText(/2 of 4 details were found/)).toBeInTheDocument();
    expect(screen.getByText(/Not found: Place, Ends/)).toBeInTheDocument();
    expect(screen.getByText('worth checking')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Review these details' }));
    expect(screen.getByLabelText('Title')).toHaveValue('TechFest 2026 — Coding Contest');
    expect(screen.getAllByText(/Found from the page’s summary tags/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Check this —/)).toBeInTheDocument();
  });

  it('sends only the fields the professor changed as overrides', async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Import from a link' }));
    await user.type(
      screen.getByLabelText('Event page'),
      'https://fest.example.ac.in/techfest-2026',
    );
    await user.click(screen.getByRole('button', { name: 'Read the page' }));
    await user.click(await screen.findByRole('button', { name: 'Review these details' }));

    await user.clear(screen.getByLabelText('Title'));
    await user.type(screen.getByLabelText('Title'), 'TechFest 2026');
    await user.click(screen.getByRole('button', { name: 'Save event' }));

    await screen.findByText('Saved as a new event.');
    const commit = calls.find((call) => call.path === '/api/v1/events/import/commit');
    expect(commit?.body?.edited).toEqual(['title']);
    expect(commit?.body?.url).toBe('https://fest.example.ac.in/techfest-2026');
  });

  it('shows a Devpost link as its own state, not as an error toast (D-30)', async () => {
    backend({ preview: MANUAL_ONLY_PREVIEW });
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Import from a link' }));
    await user.type(screen.getByLabelText('Event page'), 'https://devpost.com/software/codestorm');
    await user.click(screen.getByRole('button', { name: 'Read the page' }));

    const banner = await screen.findByText('Devpost is not read automatically');
    expect(banner.closest('[role="status"]')).toHaveTextContent(
      "Devpost doesn't allow automated reading",
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await expect(document.body).toBeAccessible();

    await user.click(screen.getByRole('button', { name: 'Type the details in, with this link' }));
    expect(screen.getByLabelText('Official link')).toHaveValue(
      'https://devpost.com/software/codestorm',
    );
  });

  it('turns a refusal into something to do next', async () => {
    backend({ previewStatus: 409 });
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Import from a link' }));
    await user.type(
      screen.getByLabelText('Event page'),
      'https://fest.example.ac.in/techfest-2026',
    );
    await user.click(screen.getByRole('button', { name: 'Read the page' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('That site asks not to be read automatically.');
    expect(alert).toHaveTextContent('Type the details in');
  });

  it('never saves during a preview', async () => {
    const calls = backend();
    const user = userEvent.setup();
    renderWithProviders(<CreateEventPage />);
    await user.click(screen.getByRole('button', { name: 'Import from a link' }));
    await user.type(
      screen.getByLabelText('Event page'),
      'https://fest.example.ac.in/techfest-2026',
    );
    await user.click(screen.getByRole('button', { name: 'Read the page' }));
    await screen.findByText(/details were found/);
    expect(calls.map((call) => call.path)).toEqual(['/api/v1/events/import/preview']);
  });
});
