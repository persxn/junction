import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi, makeStudent, type StudentsApi } from '../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const ASHA = makeStudent(7, {
  fullName: 'Asha Demo',
  tags: [
    {
      tagId: '0192f0c1-0000-7000-8000-000000008001',
      name: 'Python',
      relation: 'SKILL',
      proficiency: 3,
    },
  ],
});

let api: StudentsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  api = installStudentsApi({ students: [ASHA] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function open(
  roles?: ('ADMINISTRATOR' | 'PROFESSOR')[],
): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderApp(`/students/${ASHA.id}`, roles === undefined ? {} : { roles });
  await screen.findByRole('heading', { level: 1, name: /Asha Demo/ });
  return user;
}

const skills = (): HTMLElement => screen.getByRole('heading', { name: 'Skills' }).parentElement!;

describe('skills and interests', () => {
  it('shows a level in words, and adds a skill at once with Undo', async () => {
    const user = await open();
    expect(within(skills()).getByLabelText('Level of Python')).toHaveDisplayValue('Advanced');

    await user.type(screen.getByLabelText('Add a skill'), 'SQL');
    await user.selectOptions(screen.getByLabelText('Level'), 'Beginner');
    await user.click(within(skills()).getByRole('button', { name: 'Add' }));
    // Optimistic: on the page before the server has answered.
    expect(within(skills()).getByText('SQL')).toBeInTheDocument();
    await screen.findByText('Added SQL');
    expect(api.students.get(ASHA.id)?.tags.map((tag) => tag.name)).toEqual(['Python', 'SQL']);

    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.students.get(ASHA.id)?.tags.map((tag) => tag.name)).toEqual(['Python']);
    });
    expect(within(skills()).queryByText('SQL')).toBeNull();
  });

  it('puts the page back and offers a reload when someone else changed the student', async () => {
    installStudentsApi({ students: [ASHA], conflictOnTags: true });
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Remove Python' }));
    expect(await screen.findByText('Someone else changed this student')).toBeInTheDocument();
    expect(within(skills()).getByText('Python')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });
});

describe('deactivating and erasing', () => {
  it('deactivates at once, with Undo', async () => {
    const user = await open();
    await user.click(screen.getByRole('button', { name: 'Deactivate' }));
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    await screen.findByText('Asha Demo is now inactive');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => {
      expect(api.students.get(ASHA.id)?.status).toBe('ACTIVE');
    });
  });

  it('offers no Erase to a professor', async () => {
    await open();
    expect(screen.queryByRole('button', { name: /Erase/ })).toBeNull();
  });

  it('asks an administrator to type the roll number before erasing', async () => {
    installStudentsApi({ students: [{ ...ASHA, canErase: true }] });
    const user = await open(['ADMINISTRATOR', 'PROFESSOR']);
    await user.click(screen.getByRole('button', { name: 'Erase…' }));
    const dialog = screen.getByRole('dialog', { name: 'Erase Asha Demo?' });
    const erase = within(dialog).getByRole('button', { name: 'Erase for good' });
    expect(erase).toBeDisabled();
    await user.type(within(dialog).getByRole('textbox'), 'demo 0007');
    expect(erase).toBeEnabled();
    await user.click(erase);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Erased student' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/erased this student’s personal details/)).toHaveAttribute(
      'role',
      'status',
    );
  });
});

describe('sections still to come', () => {
  it('says what will fill Teams and Competitions', async () => {
    await open();
    expect(screen.getByText(/Not in a team yet/)).toBeInTheDocument();
    expect(screen.getByText(/No competitions yet/)).toBeInTheDocument();
  });
});
