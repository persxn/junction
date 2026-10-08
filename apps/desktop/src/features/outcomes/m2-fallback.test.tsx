import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import { installCompetitionsApi, makeEvent } from '../../testing/competitions-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { renderApp, renderWithProviders } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import { makeStudent } from '../../testing/students-api.js';
import { makeTeam, memberOf } from '../../testing/teams-api.js';
import { ADMIN, installUsersApi, PROFESSOR } from '../../testing/users-api.js';
import { UsersPage } from '../admin/users/UsersPage.js';

/**
 * M2's closing pass (WP-21 step 9): the two M2 writes no earlier sweep sent
 * through the shell proxy alone (R78/F9) — an assignment from the assign flow,
 * and an ownership transfer's preview and commit.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const proxied = () =>
  invoke.mock.calls
    .filter((call) => call[0] === 'backend_request')
    .map((call) => (call[1] as { request: { method: string; path: string } }).request);

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('assigns an event with its workflow template', async () => {
    const items = [makeItem(1)];
    const asha = makeStudent(7, { fullName: 'Asha Demo' });
    const rocket = makeTeam(1, { name: 'Team Rocket', members: [memberOf(asha)] });
    installFakeSearch(items);
    installCompetitionsApi({
      teams: [rocket],
      events: [makeEvent(1, { id: items[0]!.id, title: items[0]!.title })],
    });
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: items[0]!.title });
    await user.keyboard('a');
    const dialog = await screen.findByRole('dialog');
    await user.click(await within(dialog).findByRole('radio', { name: /Team Rocket/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await within(dialog).findByRole('radio', { name: /^Hackathon/ });
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await within(dialog).findByText('Registration closes');
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => {
      expect(proxied()).toContainEqual(
        expect.objectContaining({ method: 'POST', path: '/api/v1/competitions/assign' }),
      );
    });
  });

  it('previews and commits an ownership transfer', async () => {
    installUsersApi();
    const users = globalThis.fetch;
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string, init?: RequestInit) => {
        const path = new URL(url).pathname;
        const json = (body: unknown) =>
          Promise.resolve({
            ok: true,
            status: 200,
            text: () => Promise.resolve(JSON.stringify(body)),
          });
        if (path.endsWith('/preview')) {
          return json({
            from: { userId: PROFESSOR.id, displayName: PROFESSOR.displayName },
            to: { userId: ADMIN.id, displayName: ADMIN.displayName },
            teams: [
              {
                kind: 'TEAM',
                entityId: '0192f0c1-0000-7000-8000-000000000b01',
                name: 'Team Rocket',
                sentence: 'moves',
              },
            ],
            competitions: [],
            mentorships: [],
            staysWith: [],
            previewToken: 'b'.repeat(64),
          });
        }
        if (path.endsWith('/commit'))
          return json({ teams: 1, competitions: 0, mentorships: 0, auditRows: 2 });
        return users(url, init);
      }),
    );
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);
    await user.click(await screen.findByRole('button', { name: 'Transfer ownership…' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('From'), PROFESSOR.id);
    await user.selectOptions(within(dialog).getByLabelText('To'), ADMIN.id);
    await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
    await user.click(await within(dialog).findByRole('button', { name: 'Confirm transfer' }));
    expect(await within(dialog).findByText(/Moved 1 team/)).toBeInTheDocument();
    expect(proxied().map((request) => request.path)).toEqual(
      expect.arrayContaining([
        '/api/v1/admin/ownership-transfer/preview',
        '/api/v1/admin/ownership-transfer/commit',
      ]),
    );
  });
});
