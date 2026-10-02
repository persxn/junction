import {
  PROGRAM_LABELS,
  STUDENT_IMPORT_ACTIONS,
  STUDENT_PROGRAMS,
  STUDENT_STATUSES,
} from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport, useShellTransportForTests } from '../../api/client.js';
import { TEST_USER } from '../../testing/auth.js';
import { renderApp } from '../../testing/render.js';
import { installShellProxy } from '../../testing/shell-fallback.js';
import {
  installStudentsApi,
  makeStudent,
  mentoredBy,
  type StudentsApi,
} from '../../testing/students-api.js';

/**
 * WP-17's UI fault sweep, beyond the behaviour suites: forced states, a write
 * with the shell proxy as the only transport (R78/F9), the dialog's keyboard
 * trap, the settings card, and a scan of the rendered words for anything a
 * person should never read — an enum value or an ISO timestamp.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke, isTauri: () => false }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const ASHA = makeStudent(7, {
  fullName: 'Asha Demo',
  status: 'ALUMNI',
  program: 'MTECH',
  tags: [
    {
      tagId: '0192f0c1-0000-7000-8000-000000008001',
      name: 'Python',
      relation: 'SKILL',
      proficiency: null,
    },
    {
      tagId: '0192f0c1-0000-7000-8000-000000008002',
      name: 'Robotics',
      relation: 'INTEREST',
      proficiency: null,
    },
  ],
  mentors: [mentoredBy(TEST_USER.id, TEST_USER.displayName)],
  achievements: [
    {
      id: '0192f0c1-0000-7000-8000-000000009001',
      title: 'Winner',
      eventName: 'Smart India Hackathon',
      year: 2025,
      result: 'First',
      url: null,
      notes: null,
    },
  ],
  canErase: true,
});

let api: StudentsApi;
beforeEach(() => {
  localStorage.clear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  resetApiTransport();
  api = installStudentsApi({ students: [ASHA] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// A programme whose label is its code ("BCA") is a word a person writes too.
const RAW_WORDS = [
  ...STUDENT_STATUSES,
  ...STUDENT_PROGRAMS.filter((program) => PROGRAM_LABELS[program] !== program),
  ...STUDENT_IMPORT_ACTIONS,
  'SKILL',
  'INTEREST',
];
const ISO = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function expectHumanText(): void {
  const text = document.getElementById('main')?.innerText ?? document.body.textContent ?? '';
  for (const word of RAW_WORDS)
    expect(text, `raw value ${word}`).not.toMatch(new RegExp(`\\b${word}\\b`));
  expect(text).not.toMatch(ISO);
}

describe('no enum value or ISO timestamp reaches the screen', () => {
  it('on the list', async () => {
    await renderApp('/students');
    await screen.findByText('Asha Demo');
    expectHumanText();
  });

  it('on the student page', async () => {
    await renderApp(`/students/${ASHA.id}`, { roles: ['ADMINISTRATOR', 'PROFESSOR'] });
    await screen.findByRole('heading', { level: 1, name: /Asha Demo/ });
    expect(screen.getByText('Alumni')).toBeInTheDocument();
    expect(screen.getByLabelText('Level of Python')).toHaveDisplayValue('Not rated');
    expectHumanText();
  });

  it('on the import preview', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderApp('/students/import');
    await user.click(await screen.findByRole('button', { name: 'Choose a file…' }));
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type=file]')!,
      new File(['a'], 'x.csv'),
    );
    await screen.findByRole('heading', { name: 'What will happen' });
    await user.click(screen.getByRole('button', { name: /All rows/ }));
    expectHumanText();
  });
});

describe('forced states', () => {
  it('a student that does not exist says so and leads back', async () => {
    await renderApp('/students/0192f0c1-0000-7000-8000-0000000fffff');
    expect(await screen.findByText('This student could not be loaded')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back to students' })).toBeInTheDocument();
  });

  it('a list that fails to load offers to try again', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 500,
          text: () =>
            Promise.resolve(
              '{"type":"urn:compintel:problem:INTERNAL","title":"Something went wrong","status":500,"code":"INTERNAL","requestId":"r"}',
            ),
        }),
      ),
    );
    await renderApp('/students');
    expect(
      await screen.findByText('The student list could not be loaded', {}, { timeout: 10_000 }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('a slow list shows its skeleton, announced', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => undefined)),
    );
    await renderApp('/students');
    expect(await screen.findByText('Loading students')).toBeInTheDocument();
    expect(screen.getByText('Loading students').closest('[role="status"]')).toHaveAttribute(
      'aria-busy',
      'true',
    );
  });

  it('a failed tag removal puts the skill back and says why', async () => {
    installStudentsApi({ students: [ASHA], failTags: true });
    const user = userEvent.setup();
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByRole('heading', { level: 1, name: /Asha Demo/ });
    await user.click(screen.getByRole('button', { name: 'Remove Python' }));
    expect(await screen.findByText('The skills and interests were not saved')).toBeInTheDocument();
    expect(screen.getByText('The server failed while saving.')).toBeInTheDocument();
    expect(screen.getByLabelText('Level of Python')).toBeInTheDocument();
  });

  it('an erased student shows no edit controls', async () => {
    installStudentsApi({
      students: [{ ...ASHA, fullName: 'Erased student', erasedAt: '2026-09-28T10:00:00.000Z' }],
    });
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByRole('heading', { level: 1, name: 'Erased student' });
    expect(screen.queryByRole('link', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /Remove/ })).toBeNull();
    expect(screen.queryByLabelText('Add a skill')).toBeNull();
  });
});

describe('the shell proxy as the only transport (R78, F9)', () => {
  it('adds a skill with every request carried by the shell', async () => {
    installShellProxy(invoke);
    useShellTransportForTests();
    const user = userEvent.setup();
    await renderApp(`/students/${ASHA.id}`);
    await screen.findByRole('heading', { level: 1, name: /Asha Demo/ });
    await user.type(screen.getByLabelText('Add a skill'), 'SQL');
    await user.click(
      within(screen.getByRole('heading', { name: 'Skills' }).parentElement!).getByRole('button', {
        name: 'Add',
      }),
    );
    await screen.findByText('Added SQL');
    const proxied = invoke.mock.calls
      .filter((call) => call[0] === 'backend_request')
      .map((call) => (call[1] as { request: { method: string; path: string } }).request);
    expect(proxied).toContainEqual(
      expect.objectContaining({ method: 'PUT', path: `/api/v1/students/${ASHA.id}/tags` }),
    );
    expect(api.students.get(ASHA.id)?.tags.map((tag) => tag.name)).toContain('SQL');
  });
});

describe('the keyboard', () => {
  it('the erase dialog keeps Tab inside, closes on Esc and gives focus back', async () => {
    const user = userEvent.setup();
    await renderApp(`/students/${ASHA.id}`, { roles: ['ADMINISTRATOR', 'PROFESSOR'] });
    await screen.findByRole('heading', { level: 1, name: /Asha Demo/ });
    const opener = screen.getByRole('button', { name: 'Erase…' });
    await user.click(opener);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('textbox')).toHaveFocus();
    for (let step = 0; step < 4; step += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
    });
    expect(opener).toHaveFocus();
  });
});

describe('Admin → Campus & settings', () => {
  it('switches phone numbers on, and the form then asks for one', async () => {
    const user = userEvent.setup();
    await renderApp('/admin/settings', { roles: ['ADMINISTRATOR', 'PROFESSOR'] });
    const phone = await screen.findByRole('switch', { name: /Keep students’ phone numbers/ });
    expect(phone).not.toBeChecked();
    await user.click(phone);
    await screen.findByText('Student settings saved');
    expect(api.settings.value).toEqual({ phoneEnabled: true, allowExternal: false });
    expect(screen.getByRole('button', { name: /About these settings/ })).toBeInTheDocument();
  });

  it('the form has no phone field while phone numbers are off', async () => {
    await renderApp('/students/new');
    await screen.findByRole('heading', { level: 1, name: 'Add a student' });
    expect(screen.queryByLabelText('Phone')).toBeNull();
    expect(screen.queryByText('Another institution')).toBeNull();
  });
});
