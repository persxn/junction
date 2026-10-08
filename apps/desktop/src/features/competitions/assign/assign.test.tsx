import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import {
  installCompetitionsApi,
  makeEvent,
  type CompetitionsApi,
} from '../../../testing/competitions-api.js';
import { installFakeSearch, makeItem } from '../../../testing/fake-search.js';
import { renderApp, renderInRouter } from '../../../testing/render.js';
import { makeStudent } from '../../../testing/students-api.js';
import { makeTeam, memberOf } from '../../../testing/teams-api.js';
import { CTF, HACKATHON } from '../../../testing/workflow-fixtures.js';
import { stepLabel, withStep, type AssignStep } from './assign-model.js';
import { AssignDialog } from './AssignDialog.js';
import { ASSIGN_STEPS } from './steps.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const ITEMS = [makeItem(1), makeItem(2)];
const EVENT = makeEvent(1, {
  id: ITEMS[0]!.id,
  title: ITEMS[0]!.title,
  registrationDeadlineAt: Date.parse('2026-10-07T00:00:00.000Z'),
});
const ASHA = makeStudent(7, { fullName: 'Asha Demo' });
const RAVI = makeStudent(8, { fullName: 'Ravi Demo' });
const ROCKET = makeTeam(1, { name: 'Team Rocket', members: [memberOf(ASHA), memberOf(RAVI)] });

let api: CompetitionsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installFakeSearch(ITEMS);
  api = installCompetitionsApi({ teams: [ROCKET], events: [EVENT] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openFromKey(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderApp('/discover');
  await screen.findByRole('heading', { name: ITEMS[0]!.title });
  await user.keyboard('a');
  await screen.findByRole('dialog', { name: `Assign “${ITEMS[0]!.title}”` });
  return user;
}

describe('the assign flow (R98)', () => {
  it('A opens it from Discover; team → review → confirm → Assign → Open competition', async () => {
    const user = await openFromKey();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Step 1 of 4')).toBeInTheDocument();
    const next = within(dialog).getByRole('button', { name: 'Next' });
    expect(next).toBeDisabled();
    await user.click(await within(dialog).findByRole('radio', { name: /Team Rocket/ }));
    await user.click(next);

    // WP-20a: the type's default is preselected.
    expect(within(dialog).getByText('Step 2 of 4')).toBeInTheDocument();
    expect(await within(dialog).findByRole('radio', { name: /^Hackathon/ })).toBeChecked();
    expect(within(dialog).getByRole('radio', { name: /Blank workflow/ })).not.toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect(within(dialog).getByText('Step 3 of 4')).toBeInTheDocument();
    // The date keeps its precision: a day, never "00:00".
    expect(await within(dialog).findByText('by 7 Oct')).toBeInTheDocument();
    expect(within(dialog).getByText('Registration closes in 2 days.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Next' }));

    expect(within(dialog).getByText(/Taking part: Asha Demo, Ravi Demo/)).toBeInTheDocument();
    expect(within(dialog).getByText(/starts the “Hackathon” workflow/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await user.click(await screen.findByRole('button', { name: 'Open competition' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: `Team Rocket — ${ITEMS[0]!.title}` }),
    ).toBeInTheDocument();
    expect(api.calls.find((call) => call.path === '/api/v1/competitions/assign')?.body).toEqual({
      eventId: ITEMS[0]!.id,
      teamId: ROCKET.id,
      workflow: { templateId: HACKATHON.id, dueOverrides: {} },
      initialStatus: 'ASSIGNED',
    });
  });

  it('"Just considering" creates it at Considering', async () => {
    const user = await openFromKey();
    await user.click(await screen.findByRole('radio', { name: /Team Rocket/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('radio', { name: /^Hackathon/ });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('by 7 Oct');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Just considering' }));
    await screen.findByText(/Now considering/);
    expect([...api.competitions.values()][0]?.status).toBe('CONSIDERING');
  });

  it('a conflict blocks, naming the other competition', async () => {
    installCompetitionsApi({
      teams: [ROCKET],
      events: [EVENT],
      activeElsewhere: { [ASHA.id]: 'Team Comet — HackXYZ 2026' },
    });
    const user = await openFromKey();
    await user.click(await screen.findByRole('radio', { name: /Team Rocket/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('radio', { name: /^Hackathon/ });
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(
      await screen.findByText('Asha Demo is already in Team Comet — HackXYZ 2026 for this event.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('the card’s Assign button opens it too', async () => {
    const user = userEvent.setup();
    await renderApp('/discover');
    const card = (await screen.findByRole('heading', { name: ITEMS[1]!.title })).closest(
      'article',
    )!;
    await user.click(within(card).getByRole('button', { name: 'Assign' }));
    expect(
      await screen.findByRole('dialog', { name: `Assign “${ITEMS[1]!.title}”` }),
    ).toBeInTheDocument();
  });
});

describe('the workflow steps (WP-20a)', () => {
  it('"Workflow template" sits at index 1 and the step array still takes insertions', () => {
    expect(ASSIGN_STEPS.map((step) => step.title)).toEqual([
      'Team or students',
      'Workflow template',
      'Review dates',
      'Confirm',
    ]);
    const extra: AssignStep = { ...ASSIGN_STEPS[0]!, id: 'extra' };
    expect(stepLabel(1, withStep(ASSIGN_STEPS, 1, extra))).toBe('Step 2 of 5');
  });

  it('another template and an edited date reach the request', async () => {
    const user = userEvent.setup();
    await renderInRouter(
      <AssignDialog event={{ id: EVENT.id, title: EVENT.title }} onClose={() => undefined} />,
    );
    await user.click(await screen.findByRole('radio', { name: /Team Rocket/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('radio', { name: /^CTF/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    const first = await screen.findByLabelText(/Team & registration/);
    expect(first).toHaveValue('2026-10-18T23:59');
    expect(screen.getAllByText('No date — set one')).toHaveLength(2);
    fireEvent.change(first, { target: { value: '2026-10-16T10:30' } });
    expect(screen.getByText(/Your date: 16 Oct, 10:30/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => {
      expect(
        api.calls.find((call) => call.path === '/api/v1/competitions/assign')?.body,
      ).toMatchObject({
        workflow: {
          templateId: CTF.id,
          dueOverrides: { [CTF.stages[0]!.id]: '2026-10-16T05:00:00.000Z' },
        },
      });
    });
  });

  it('Blank workflow says so on the dates step and sends only its choice', async () => {
    const user = userEvent.setup();
    await renderInRouter(
      <AssignDialog event={{ id: EVENT.id, title: EVENT.title }} onClose={() => undefined} />,
    );
    await user.click(await screen.findByRole('radio', { name: /Team Rocket/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(await screen.findByRole('radio', { name: /Blank workflow/ }));
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByText(/A blank workflow has no stages yet/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await user.click(screen.getByRole('button', { name: 'Assign' }));
    await waitFor(() => {
      expect(
        api.calls.find((call) => call.path === '/api/v1/competitions/assign')?.body?.workflow,
      ).toEqual({ templateId: null });
    });
  });
});
