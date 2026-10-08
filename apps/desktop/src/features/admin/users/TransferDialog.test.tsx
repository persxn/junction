import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { renderWithProviders } from '../../../testing/render.js';
import { ADMIN, installUsersApi, PROFESSOR } from '../../../testing/users-api.js';
import { UsersPage } from './UsersPage.js';

/**
 * Admin → Users → Transfer ownership… (WP-21, R105, jsdom): the preview in its
 * four groups, Confirm and the summary, an empty preview that cannot be
 * confirmed, and a stale preview that is reloaded.
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.setConfig({ testTimeout: 20_000 });

const item = (kind: string, n: number, sentence: string) => ({
  kind,
  entityId: `0192f0c1-0000-7000-8000-${String(n).padStart(12, '0')}`,
  name: `${kind.toLowerCase()} ${String(n)}`,
  sentence,
});
const PREVIEW = {
  from: { userId: PROFESSOR.id, displayName: PROFESSOR.displayName },
  to: { userId: ADMIN.id, displayName: ADMIN.displayName },
  teams: [item('TEAM', 1, 'A. Professor (primary mentor) → A. Administrator (primary mentor)')],
  competitions: [item('COMPETITION', 2, 'moves'), item('COMPETITION', 3, 'moves')],
  mentorships: [item('MENTORSHIP', 4, 'A. Professor → A. Administrator')],
  staysWith: [item('TEAM', 5, 'Stays with A. Professor — history')],
  previewToken: 'a'.repeat(64),
};

let previews = 0;
let commits = 0;
function install(options: { empty?: boolean; staleOnce?: boolean } = {}): void {
  previews = 0;
  commits = 0;
  installUsersApi();
  const users = globalThis.fetch;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const json = (status: number, body: unknown) =>
        Promise.resolve({
          ok: status < 300,
          status,
          text: () => Promise.resolve(JSON.stringify(body)),
        });
      if (path.endsWith('/ownership-transfer/preview')) {
        previews += 1;
        return json(
          200,
          options.empty === true
            ? { ...PREVIEW, teams: [], competitions: [], mentorships: [], staysWith: [] }
            : PREVIEW,
        );
      }
      if (path.endsWith('/ownership-transfer/commit')) {
        commits += 1;
        if (options.staleOnce === true && commits === 1) {
          return json(409, {
            type: 'urn:compintel:problem:TRANSFER_PREVIEW_STALE',
            title: 'Something changed since the preview',
            detail: 'Something changed since the preview — review it again.',
            status: 409,
            code: 'TRANSFER_PREVIEW_STALE',
            requestId: 'r',
          });
        }
        return json(200, { teams: 1, competitions: 2, mentorships: 1, auditRows: 5 });
      }
      return users(url, init);
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPreview() {
  const user = userEvent.setup();
  renderWithProviders(<UsersPage />);
  await user.click(await screen.findByRole('button', { name: 'Transfer ownership…' }));
  const dialog = await screen.findByRole('dialog', { name: 'Transfer ownership' });
  await user.selectOptions(within(dialog).getByLabelText('From'), PROFESSOR.id);
  await user.selectOptions(within(dialog).getByLabelText('To'), ADMIN.id);
  await user.click(within(dialog).getByRole('button', { name: 'Preview' }));
  return { user, dialog };
}

describe('Transfer ownership…', () => {
  it('previews four groups with counts and sentences, then confirms with a summary', async () => {
    install();
    const { user, dialog } = await openPreview();
    expect(await within(dialog).findByRole('heading', { name: 'Teams (1)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Competitions (2)' })).toBeInTheDocument();
    expect(within(dialog).getByRole('heading', { name: 'Mentorships (1)' })).toBeInTheDocument();
    expect(
      within(dialog).getByRole('heading', { name: 'Stays as history (1)' }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/A. Professor \(primary mentor\) → A. Administrator/),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Confirm transfer' }));
    expect(
      await within(dialog).findByText(/Moved 1 team, 2 competitions and 1 mentorship/),
    ).toBeInTheDocument();
  });

  it('an empty preview cannot be confirmed', async () => {
    install({ empty: true });
    const { dialog } = await openPreview();
    expect(await within(dialog).findByText(/Nothing to move/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Confirm transfer' })).toBeDisabled();
  });

  it('a stale preview says so and is reloaded', async () => {
    install({ staleOnce: true });
    const { user, dialog } = await openPreview();
    await user.click(await within(dialog).findByRole('button', { name: 'Confirm transfer' }));
    expect(
      await within(dialog).findByText('Something changed since the preview — review it again.'),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(previews).toBe(2);
    });
    expect(commits).toBe(1);
  });

  it('only active professors are offered as the receiver', async () => {
    install();
    const user = userEvent.setup();
    renderWithProviders(<UsersPage />);
    await user.click(await screen.findByRole('button', { name: 'Transfer ownership…' }));
    const dialog = await screen.findByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('From'), ADMIN.id);
    const to = within(dialog).getByLabelText('To');
    expect(within(to).queryByRole('option', { name: ADMIN.displayName })).toBeNull();
    expect(within(to).getByRole('option', { name: PROFESSOR.displayName })).toBeInTheDocument();
  });
});
