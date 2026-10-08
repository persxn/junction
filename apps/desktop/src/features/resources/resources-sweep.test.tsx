import {
  CHECK_STATUSES,
  OPEN_REFUSALS,
  RESOURCE_KINDS,
  RESOURCE_OWNER_KINDS,
} from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import {
  installCompetitionsApi,
  makeCompetition,
  makeEvent,
} from '../../testing/competitions-api.js';
import { renderApp } from '../../testing/render.js';
import { installResourcesApi, makeResource } from '../../testing/resources-api.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { installStudentsApi } from '../../testing/students-api.js';
import { HACKATHON, workflowFrom } from '../../testing/workflow-fixtures.js';

/**
 * WP-20b's UI fault sweep (step 7): the rendered-text scan extended to the
 * resource enums and the shell's refusals, forced states (resources failing
 * to load, none yet, a closed competition), an add with the shell proxy as
 * the only transport (R78/F9), and a keyboard-only walk through adding one.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const COMPETITION = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }));
const base = workflowFrom(COMPETITION.id, HACKATHON);
const EVERY_KIND = RESOURCE_KINDS.map((kind, index) =>
  makeResource('ENGAGEMENT', COMPETITION.id, {
    kind,
    label: `Item ${String(index)}`,
    ...(kind === 'LOCAL_PATH'
      ? { uri: 'C:\\Team\\x.pdf', machineLabel: 'LAB-PC-07', checkStatus: 'MISSING' as const }
      : {}),
  }),
);

let resources: ReturnType<typeof installResourcesApi>;
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  installStudentsApi();
  const api = installCompetitionsApi({ competitions: [COMPETITION] });
  api.workflows.workflows.set(COMPETITION.id, base);
  resources = installResourcesApi({ resources: EVERY_KIND });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const RAW_WORDS = [
  ...RESOURCE_KINDS,
  ...RESOURCE_OWNER_KINDS,
  ...CHECK_STATUSES,
  ...OPEN_REFUSALS,
  'MACHINE_LABEL',
];

function expectHumanText(): void {
  for (const details of document.querySelectorAll('details')) details.open = true;
  const text = document.getElementById('main')?.textContent ?? document.body.textContent ?? '';
  for (const word of RAW_WORDS) {
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  }
  expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
}

describe('no enum value or ISO timestamp reaches the screen', () => {
  it('with every kind of resource and the add dialog open', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    await screen.findByRole('list', { name: 'Resources of this competition' });
    expect(screen.getAllByText('GitHub repository').length).toBeGreaterThan(0);
    expectHumanText();
    await user.click(screen.getByRole('button', { name: 'Add a resource to this competition' }));
    await screen.findByRole('dialog');
    expectHumanText();
  });
});

describe('forced states', () => {
  it('resources failing to load say so and offer to try again; the rest of the page stays', async () => {
    vi.stubGlobal(
      'fetch',
      ((inner: typeof fetch) => (url: string, init?: RequestInit) =>
        new URL(url).pathname.endsWith('/resources')
          ? Promise.resolve({
              ok: false,
              status: 500,
              text: () =>
                Promise.resolve(
                  '{"type":"urn:compintel:problem:INTERNAL","title":"Something went wrong","status":500,"code":"INTERNAL","requestId":"r"}',
                ),
            })
          : inner(url, init))(globalThis.fetch),
    );
    await renderApp(`/competitions/${COMPETITION.id}`);
    expect(
      await screen.findByText(/The resources did not load/, {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Stages in order' })).toBeInTheDocument();
  });

  it('none yet says so; a closed competition offers no Add', async () => {
    installResourcesApi({ resources: [], canEdit: false });
    await renderApp(`/competitions/${COMPETITION.id}`);
    expect((await screen.findAllByText('No links or files yet.')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /^Add a resource/ })).toBeNull();
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('adds a resource with every request carried by the shell', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    await user.click(
      await screen.findByRole('button', { name: 'Add a resource to this competition' }),
    );
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Link or path'), 'https://devfolio.co/alpha');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(
        [...resources.resources.values()].some((r) => r.uri === 'https://devfolio.co/alpha'),
      ).toBe(true);
    });
    const proxied = invoke.mock.calls
      .filter((call) => call[0] === 'backend_request')
      .map((call) => (call[1] as { request: { method: string; path: string } }).request);
    expect(proxied).toContainEqual(
      expect.objectContaining({ method: 'POST', path: '/api/v1/resources' }),
    );
  });
});

describe('a keyboard-only walk', () => {
  it('Tab to Add resource, type a link, Enter adds it, focus returns', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${COMPETITION.id}`);
    const add = await screen.findByRole('button', { name: 'Add a resource to this competition' });
    for (let step = 0; step < 120 && document.activeElement !== add; step += 1) await user.tab();
    expect(add).toHaveFocus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Link or path')).toHaveFocus();
    await user.keyboard('https://example.org/walk{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await screen.findByText('walk', { selector: 'span' })).toBeInTheDocument();
    await waitFor(() => {
      expect(add).toHaveFocus();
    });
  });
});
