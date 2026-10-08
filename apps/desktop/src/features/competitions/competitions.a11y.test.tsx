import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import {
  installCompetitionsApi,
  makeCompetition,
  makeEvent,
} from '../../testing/competitions-api.js';
import { installFakeSearch, makeItem } from '../../testing/fake-search.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi, makeStudent } from '../../testing/students-api.js';
import { makeTeam, memberOf } from '../../testing/teams-api.js';

/**
 * WP-19's screens with axe (R89's `pnpm test:a11y`): the board with the move
 * menu open and with a drag in progress, the list, a competition page, and
 * the assign dialog at every step — each with its guide open.
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const ITEMS = [makeItem(1)];
const EVENT = makeEvent(1, { id: ITEMS[0]!.id, title: ITEMS[0]!.title });
const ROCKET = makeTeam(1, { name: 'Team Rocket', members: [memberOf(ASHA)] });
const COMPETITIONS = [
  makeCompetition(makeEvent(2, { title: 'Alpha Hack' })),
  makeCompetition(makeEvent(3, { title: 'Beta Hack' }), {
    status: 'CONSIDERING',
    team: null,
    kind: 'INDIVIDUAL',
    student: { id: ASHA.id, fullName: 'Asha Demo' },
  }),
];

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installFakeSearch(ITEMS);
  installCompetitionsApi({ competitions: COMPETITIONS, teams: [ROCKET], events: [EVENT] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility', () => {
  it('the board, with the move menu open and with a drag in progress', async () => {
    const user = userEvent.setup();
    await renderApp('/competitions');
    const card = await screen.findByRole('article', { name: /^Alpha Hack/ });
    await expect(document.body).toBeAccessible();
    card.focus();
    await user.keyboard('m');
    expect(screen.getByRole('menu')).toBeInTheDocument();
    await expect(document.body).toBeAccessible();
    await user.keyboard('{Escape}');
    fireEvent.dragStart(card);
    expect(screen.getAllByText('Not allowed').length).toBeGreaterThan(0);
    await expect(document.body).toBeAccessible();
  });

  it('the list', async () => {
    const user = userEvent.setup();
    await renderApp('/competitions');
    await screen.findByRole('article', { name: /^Alpha Hack/ });
    await user.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('table');
    await expect(document.body).toBeAccessible();
  });

  it('a competition page', async () => {
    installStudentsApi({ students: [ASHA] });
    installCompetitionsApi({ competitions: COMPETITIONS });
    await renderApp(`/competitions/${COMPETITIONS[0]!.id}`);
    await screen.findByRole('heading', { level: 1, name: /Alpha Hack/ });
    await expect(document.body).toBeAccessible();
  });

  it('the assign dialog, at every step', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    await screen.findByRole('heading', { name: ITEMS[0]!.title });
    await user.keyboard('a');
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('radio', { name: /Team Rocket/ });
    await expect(document.body).toBeAccessible();
    await user.click(within(dialog).getByRole('radio', { name: /Team Rocket/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await within(dialog).findByRole('radio', { name: /^Hackathon/ });
    await expect(document.body).toBeAccessible();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await within(dialog).findByText('Registration closes');
    await within(dialog).findByText(/Stage dates/);
    await expect(document.body).toBeAccessible();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));
    await expect(document.body).toBeAccessible();
  });
});
