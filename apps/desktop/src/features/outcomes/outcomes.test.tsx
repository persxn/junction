import { screen, waitFor, within } from '@testing-library/react';
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
import { HACKATHON, workflowFrom } from '../../testing/workflow-fixtures.js';
import { formatPrize, fromMinor, recordBlockedReason, toMinor } from './outcome-model.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

/**
 * The outcome panel (WP-21, R104, jsdom): offered only where allowed, recorded
 * by keyboard alone, refusals shown in the form, edited and removed, and the
 * result on the board's Completed card.
 */

const PARTICIPATING = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }), {
  status: 'PARTICIPATING',
});
const APPLIED = makeCompetition(makeEvent(2, { title: 'Beta Hack' }), { status: 'APPLIED' });

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi({ competitions: [PARTICIPATING, APPLIED] });
  for (const c of [PARTICIPATING, APPLIED])
    api.workflows.workflows.set(c.id, workflowFrom(c.id, HACKATHON));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the model (R63)', () => {
  it('turns an amount into minor units of its own currency and back', () => {
    expect(toMinor('50000', 'INR')).toBe(5_000_000);
    expect(toMinor('49.99', 'USD')).toBe(4999);
    expect(toMinor('1200', 'JPY')).toBe(1200);
    expect(toMinor('', 'INR')).toBeNull();
    expect(toMinor('ten', 'INR')).toBeUndefined();
    expect(fromMinor(5_000_000, 'INR')).toBe('50000');
    expect(formatPrize(5_000_000, 'INR')).toBe('₹50,000.00');
    expect(recordBlockedReason('ASSIGNED')).toBe(
      'Record the result once the competition is underway.',
    );
  });
});

describe('the panel', () => {
  it('is recorded by keyboard alone; the competition is completed and the result shown', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${PARTICIPATING.id}`);
    const record = await screen.findByRole('button', { name: 'Record outcome' });
    record.focus();
    await user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: 'Record the outcome' });
    expect(within(dialog).getByLabelText('Result')).toHaveFocus();
    await user.selectOptions(within(dialog).getByLabelText('Result'), 'WINNER');
    await user.tab();
    await user.keyboard('1');
    await user.tab();
    await user.keyboard('Best hack');
    await user.tab();
    await user.keyboard('50000');
    await user.tab();
    await user.keyboard('inr');
    expect(within(dialog).getByLabelText('Currency')).toHaveValue('INR');
    await user.keyboard('{Enter}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(api.outcomes.calls.at(-1)?.body).toMatchObject({
      result: 'WINNER',
      rank: 1,
      prizeText: 'Best hack',
      prizeMinor: 5_000_000,
      prizeCurrency: 'INR',
    });
    expect(await screen.findByText(/₹50,000\.00/)).toBeInTheDocument();
    expect(screen.getByText('Winner')).toBeInTheDocument();
    expect(api.competitions.get(PARTICIPATING.id)?.status).toBe('COMPLETED');
  });

  it('is not offered before the competition is underway, and says why', async () => {
    await renderApp(`/competitions/${APPLIED.id}`);
    expect(
      await screen.findByText('Record the result once the competition is underway.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record outcome' })).toBeNull();
  });

  it('a refusal is explained in the form', async () => {
    const user = userEvent.setup();
    await renderApp(`/competitions/${PARTICIPATING.id}`);
    await user.click(await screen.findByRole('button', { name: 'Record outcome' }));
    const dialog = await screen.findByRole('dialog');
    await user.type(within(dialog).getByLabelText('Prize amount (optional)'), '100');
    await user.click(within(dialog).getByRole('button', { name: 'Record outcome' }));
    expect(await within(dialog).findByText(/needs its currency/)).toBeInTheDocument();
  });

  it('is edited and removed (after confirming); the board shows the result', async () => {
    const user = userEvent.setup();
    const completed = { ...PARTICIPATING, status: 'COMPLETED' as const };
    api.competitions.set(completed.id, completed);
    await renderApp(`/competitions/${completed.id}`);
    await user.click(await screen.findByRole('button', { name: 'Record outcome' }));
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Record outcome' }),
    );
    await user.click(await screen.findByRole('button', { name: 'Edit outcome' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit the outcome' });
    await user.selectOptions(within(dialog).getByLabelText('Result'), 'FINALIST');
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Finalist')).toBeInTheDocument();
    expect(api.outcomes.calls.at(-1)?.body).toMatchObject({ version: 1 });
    await user.click(screen.getByRole('button', { name: 'Remove outcome' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove the outcome?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('button', { name: 'Record outcome' })).toBeInTheDocument();
  });
});

describe('the board', () => {
  it('a Completed card shows its result', async () => {
    api.competitions.set(PARTICIPATING.id, {
      ...PARTICIPATING,
      status: 'COMPLETED',
      result: 'RUNNER_UP',
    });
    await renderApp('/competitions?closed=true');
    const card = await screen.findByRole('article', { name: /^Alpha Hack/ });
    expect(within(card).getByText('Runner-up')).toBeInTheDocument();
  });
});
