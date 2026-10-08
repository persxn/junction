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
import { installResourcesApi, makeResource } from '../../testing/resources-api.js';
import { installStudentsApi } from '../../testing/students-api.js';
import { HACKATHON, workflowFrom } from '../../testing/workflow-fixtures.js';

/**
 * Resources on the Competition page (WP-20b, jsdom, the shell mocked): an
 * `.exe` offers Show in Explorer and no Open, another PC's path says so, the
 * web build offers Copy only; adding is optimistic with Undo and refusals
 * are shown; removing confirms; a task's menu adds one to the task.
 */

const shell = vi.hoisted(() => ({ on: false }));
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => shell.on }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const COMPETITION = makeCompetition(makeEvent(1, { title: 'Alpha Hack' }));
const base = workflowFrom(COMPETITION.id, HACKATHON);
const PDF = 'C:\\Team\\deck.pdf';
const EXE = 'C:\\Team\\setup.exe';

const resources = () => [
  makeResource('ENGAGEMENT', COMPETITION.id, {
    kind: 'LOCAL_PATH',
    uri: PDF,
    label: 'deck.pdf',
    machineLabel: 'LAB-PC-01',
  }),
  makeResource('ENGAGEMENT', COMPETITION.id, {
    kind: 'LOCAL_PATH',
    uri: EXE,
    label: 'setup.exe',
    machineLabel: 'LAB-PC-01',
  }),
  makeResource('STAGE', base.stages[0]!.id, {
    kind: 'LOCAL_PATH',
    uri: 'D:\\Shared\\notes.docx',
    label: 'notes.docx',
    machineLabel: 'LAB-PC-07',
  }),
  makeResource('ENGAGEMENT', COMPETITION.id, {
    kind: 'GITHUB',
    uri: 'https://github.com/acme/rocket',
    label: 'acme/rocket',
  }),
];

let api: CompetitionsApi;
let res: ReturnType<typeof installResourcesApi>;
beforeEach(() => {
  localStorage.clear();
  shell.on = false;
  invoke.mockReset();
  invoke.mockImplementation((command: string, args?: { paths?: string[] }) => {
    if (command === 'machine_label') return Promise.resolve('LAB-PC-01');
    if (command === 'stat_paths') {
      return Promise.resolve({
        machineLabel: 'LAB-PC-01',
        results: (args?.paths ?? []).map((path) => ({
          path,
          status: 'OK',
          openable: path.endsWith('.pdf'),
          reason: path.endsWith('.pdf') ? null : 'BLOCKED_TYPE',
        })),
      });
    }
    if (command === 'open_local_path' || command === 'reveal_path') {
      return Promise.resolve({ done: true });
    }
    return Promise.resolve(undefined);
  });
  resetApiTransport();
  installStudentsApi();
  api = installCompetitionsApi({ competitions: [COMPETITION] });
  api.workflows.workflows.set(COMPETITION.id, base);
  res = installResourcesApi({ resources: resources() });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openPage() {
  const user = userEvent.setup();
  await renderApp(`/competitions/${COMPETITION.id}`);
  await screen.findByRole('list', { name: 'Resources of this competition' });
  return user;
}
const row = (label: string): HTMLElement =>
  screen.getByText(label, { selector: 'span' }).closest('li')!;

describe('in the desktop app', () => {
  beforeEach(() => {
    shell.on = true;
  });

  it('a document opens; a program is shown in Explorer and never opened', async () => {
    const user = await openPage();
    const pdf = row('deck.pdf');
    await user.click(await within(pdf).findByRole('button', { name: 'Open deck.pdf' }));
    expect(invoke).toHaveBeenCalledWith('open_local_path', { path: PDF });

    const exe = row('setup.exe');
    expect(within(exe).queryByRole('button', { name: /^Open/ })).toBeNull();
    expect(
      within(exe).getByText(/Programs and scripts can’t be opened from CompIntel/),
    ).toBeInTheDocument();
    await user.click(within(exe).getByRole('button', { name: 'Show setup.exe in Explorer' }));
    expect(invoke).toHaveBeenCalledWith('reveal_path', { path: EXE });
    expect(invoke).not.toHaveBeenCalledWith('open_local_path', { path: EXE });
  });

  it('a path from another PC says where it lives; only this PC’s paths are checked and reported', async () => {
    await openPage();
    const other = row('notes.docx');
    expect(within(other).getByText(/On LAB-PC-07 — can’t check from here/)).toBeInTheDocument();
    expect(within(other).queryByRole('button', { name: /Open|Explorer/ })).toBeNull();
    const stat = invoke.mock.calls.find((call) => call[0] === 'stat_paths');
    expect((stat?.[1] as { paths: string[] }).paths.sort()).toEqual([PDF, EXE].sort());
    await waitFor(() => {
      expect(res.calls.some((call) => call.path.endsWith('/check-results'))).toBe(true);
    });
    const posted = res.calls.find((call) => call.path.endsWith('/check-results'))?.body as {
      results: { id: string }[];
    };
    expect(posted.results).toHaveLength(2);
  });
});

describe('in the web build', () => {
  it('a path offers Copy only, with the reason; a link still opens', async () => {
    await openPage();
    const pdf = row('deck.pdf');
    expect(within(pdf).queryByRole('button', { name: /Open|Explorer/ })).toBeNull();
    expect(
      within(pdf).getByText(/Opening files needs the CompIntel desktop app/),
    ).toBeInTheDocument();
    expect(within(pdf).getByRole('button', { name: 'Actions for deck.pdf' })).toBeInTheDocument();
    expect(
      within(row('acme/rocket')).getByRole('button', { name: 'Open acme/rocket' }),
    ).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith('stat_paths', expect.anything());
  });
});

describe('adding and removing', () => {
  it('adds a link at once with Undo; a refused one is explained in the dialog', async () => {
    const user = await openPage();
    await user.click(screen.getByRole('button', { name: 'Add a resource to this competition' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Add a resource to this competition',
    });
    await user.type(within(dialog).getByLabelText('Link or path'), 'javascript:alert(1)');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(
      await within(dialog).findByText(/Only web links \(http or https\) and paths on a PC/),
    ).toBeInTheDocument();
    const field = within(dialog).getByLabelText('Link or path');
    await user.clear(field);
    await user.type(field, 'https://devfolio.co/alpha');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(await screen.findByText('alpha', { selector: 'span' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(screen.queryByText('alpha', { selector: 'span' })).toBeNull();
    });
  });

  it('removing confirms first', async () => {
    const user = await openPage();
    await user.click(
      within(row('acme/rocket')).getByRole('button', { name: 'Actions for acme/rocket' }),
    );
    await user.click(screen.getByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove “acme/rocket”?' });
    expect(within(dialog).getByText(/the file or page itself is not touched/)).toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => {
      expect(screen.queryByText('acme/rocket', { selector: 'span' })).toBeNull();
    });
  });

  it('a task’s menu adds a resource to that task', async () => {
    const user = await openPage();
    await user.click(screen.getByRole('button', { name: 'Actions for Confirm the team' }));
    await user.click(screen.getByRole('menuitem', { name: 'Add a resource' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Add a resource to “Confirm the team”',
    });
    await user.type(within(dialog).getByLabelText('Link or path'), 'https://docs.google.com/d/x');
    await user.click(within(dialog).getByRole('button', { name: 'Add' }));
    expect(
      await screen.findByRole('list', { name: 'Resources of Confirm the team' }),
    ).toBeInTheDocument();
    const added = res.calls.find(
      (call) => call.method === 'POST' && call.path === '/api/v1/resources',
    );
    expect(added?.body).toMatchObject({ ownerKind: 'TASK', ownerId: base.stages[0]!.tasks[0]!.id });
  });
});
