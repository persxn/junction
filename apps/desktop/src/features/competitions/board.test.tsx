import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import {
  installCompetitionsApi,
  makeCompetition,
  makeEvent,
  type CompetitionsApi,
} from '../../testing/competitions-api.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi } from '../../testing/students-api.js';
import { canDrop, moveLabel, moveTargets, needsConfirm, undoable } from './board-model.js';
import { DEFAULT_COMPETITIONS_SEARCH, parseCompetitionsSearch, toQuery } from './search-state.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const ASSIGNED = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }), {
  team: { id: '0192f0c1-0000-7000-8000-00000000b001', name: 'Team Rocket' },
});
const APPLIED = makeCompetition(makeEvent(2, { title: 'Beta Hack' }), {
  status: 'APPLIED',
  team: { id: '0192f0c1-0000-7000-8000-00000000b002', name: 'Team Comet' },
});

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi({ competitions: [ASSIGNED, APPLIED] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const column = (name: RegExp): HTMLElement => screen.getByRole('region', { name });
const card = (title: string): HTMLElement =>
  screen.getByRole('article', { name: new RegExp(`^${title}`) });

async function openBoard() {
  const user = userEvent.setup();
  await renderApp('/competitions');
  await screen.findByRole('article', { name: /^Alpha Hack/ });
  return user;
}

describe('the board rules (R97)', () => {
  it('reads the contracts table', () => {
    expect(moveTargets('ASSIGNED')).toEqual(['APPLIED', 'CONSIDERING', 'WITHDRAWN']);
    expect(canDrop('ASSIGNED', 'COMPLETED')).toBe(false);
    expect(needsConfirm('WITHDRAWN')).toBe(true);
    expect(needsConfirm('APPLIED')).toBe(false);
    expect(undoable('ASSIGNED', 'CONSIDERING')).toBe(true);
    expect(undoable('ASSIGNED', 'APPLIED')).toBe(false);
    expect(moveLabel('NOT_SELECTED')).toBe('Mark not selected');
  });
});

describe('the pipeline board', () => {
  it('a keyboard move through the menu, announced, with Undo for Assigned → Considering', async () => {
    const user = await openBoard();
    card('Alpha Hack').focus();
    await user.keyboard('m');
    const menu = screen.getByRole('menu', { name: 'Move Team Rocket to' });
    expect(
      within(menu)
        .getAllByRole('menuitem')
        .map((item) => item.textContent),
    ).toEqual(['Move to Applied', 'Move to Considering', 'Withdraw']);
    expect(within(menu).getByRole('menuitem', { name: 'Move to Applied' })).toHaveFocus();
    await user.keyboard('{ArrowDown}{Enter}');
    expect(await screen.findByText('Team Rocket moved to Considering.')).toBeInTheDocument();
    expect(within(column(/^Considering/)).getByText('Alpha Hack')).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.competitions.get(ASSIGNED.id)?.status).toBe('ASSIGNED');
    });
  });

  it('offers no Undo for a forward move', async () => {
    const user = await openBoard();
    card('Alpha Hack').focus();
    await user.keyboard('m{Enter}');
    await screen.findByText('Team Rocket — Applied');
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('arrows move between cards and columns; Enter opens the competition', async () => {
    const user = await openBoard();
    card('Alpha Hack').focus();
    await user.keyboard('{ArrowRight}');
    expect(card('Beta Hack')).toHaveFocus();
    await user.keyboard('{ArrowLeft}');
    expect(card('Alpha Hack')).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Team Rocket — Alpha Hack' }),
    ).toBeInTheDocument();
  });

  it('a drop on a disallowed column says so inline and the card returns', async () => {
    await openBoard();
    fireEvent.dragStart(card('Alpha Hack'));
    expect(within(column(/^Completed/)).getByText('Not allowed')).toBeInTheDocument();
    expect(within(column(/^Applied/)).queryByText('Not allowed')).toBeNull();
    fireEvent.dragOver(column(/^Completed/));
    fireEvent.drop(column(/^Completed/));
    expect(await within(card('Alpha Hack')).findByRole('alert')).toHaveTextContent(
      "Can't move from Assigned to Completed.",
    );
    expect(within(column(/^Assigned/)).getByText('Alpha Hack')).toBeInTheDocument();
    expect(api.competitions.get(ASSIGNED.id)?.status).toBe('ASSIGNED');
  });

  it('a drop on an allowed column moves the card', async () => {
    await openBoard();
    fireEvent.dragStart(card('Alpha Hack'));
    fireEvent.dragOver(column(/^Applied/));
    fireEvent.drop(column(/^Applied/));
    await waitFor(() => {
      expect(api.competitions.get(ASSIGNED.id)?.status).toBe('APPLIED');
    });
  });

  it('a final move asks first', async () => {
    const user = await openBoard();
    await user.click(within(card('Alpha Hack')).getByRole('button', { name: /Move Team Rocket/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Withdraw' }));
    const dialog = screen.getByRole('dialog', { name: 'Withdraw?' });
    expect(within(dialog).getByText(/This is final/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => {
      expect(api.competitions.get(ASSIGNED.id)?.status).toBe('WITHDRAWN');
    });
  });
});

describe('the list view', () => {
  it('maps its filters to the CompetitionQuery', () => {
    const search = parseCompetitionsSearch({
      view: 'list',
      status: ['APPLIED', 'NONSENSE'],
      mine: true,
      eventTypes: ['CTF'],
      deadline: 14,
      closed: true,
    });
    expect(toQuery(search)).toEqual({
      status: ['APPLIED'],
      mentorId: 'me',
      eventTypes: ['CTF'],
      deadlineWithinDays: 14,
      includeClosed: true,
    });
    // The board shows every open column, so it never narrows by status.
    expect(toQuery({ ...search, view: 'board' }).status).toBeUndefined();
    expect(toQuery(DEFAULT_COMPETITIONS_SEARCH)).toEqual({});
  });

  it('switches to the list and filters by status through the server', async () => {
    const user = await openBoard();
    await user.click(screen.getByRole('button', { name: 'List' }));
    await screen.findByRole('table');
    await user.click(
      within(screen.getByRole('group', { name: 'Status' })).getByRole('button', {
        name: 'Applied',
      }),
    );
    await waitFor(() => {
      expect(screen.getAllByRole('row')).toHaveLength(2);
    });
    expect(api.calls.at(-1)?.query).toBe('?status=APPLIED');
    expect(screen.getByRole('row', { name: /Beta Hack/ })).toBeInTheDocument();
  });
});
