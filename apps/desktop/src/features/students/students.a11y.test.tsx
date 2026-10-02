import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { TEST_USER } from '../../testing/auth.js';
import { renderApp } from '../../testing/render.js';
import { installStudentsApi, makeStudent, mentoredBy } from '../../testing/students-api.js';

/**
 * WP-17's screens with axe (R89's `pnpm test:a11y`): the list, a student with
 * every section filled, the erase dialog, the form, the import preview with an
 * error row, and the settings card — each with its guide open.
 */

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 30_000 });

const ASHA = makeStudent(7, {
  fullName: 'Asha Demo',
  tags: [
    {
      tagId: '0192f0c1-0000-7000-8000-000000008001',
      name: 'Python',
      relation: 'SKILL',
      proficiency: 2,
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
      eventName: 'A hackathon',
      year: 2025,
      result: 'First',
      url: null,
      notes: null,
    },
  ],
  canErase: true,
});

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  installStudentsApi({ students: [ASHA, makeStudent(8, { status: 'INACTIVE' })] });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const ADMIN = { roles: ['ADMINISTRATOR', 'PROFESSOR'] as ('ADMINISTRATOR' | 'PROFESSOR')[] };

describe('accessibility', () => {
  it('the list', async () => {
    await renderApp('/students');
    await screen.findByText('Asha Demo');
    await expect(document.body).toBeAccessible();
  });

  it('a student, and the erase dialog over it', async () => {
    const user = userEvent.setup();
    await renderApp(`/students/${ASHA.id}`, ADMIN);
    await screen.findByRole('heading', { level: 1, name: /Asha Demo/ });
    await expect(document.body).toBeAccessible();
    await user.click(screen.getByRole('button', { name: 'Erase…' }));
    await expect(document.body).toBeAccessible();
  });

  it('the add form', async () => {
    await renderApp('/students/new');
    await screen.findByRole('heading', { level: 1, name: 'Add a student' });
    await expect(document.body).toBeAccessible();
  });

  it('the import preview, with an error row', async () => {
    const user = userEvent.setup({ applyAccept: false });
    await renderApp('/students/import');
    await user.click(await screen.findByRole('button', { name: 'Choose a file…' }));
    await user.upload(
      document.querySelector<HTMLInputElement>('input[type=file]')!,
      new File(['a'], 'x.csv'),
    );
    await screen.findByRole('heading', { name: 'What will happen' });
    await expect(document.body).toBeAccessible();
  });

  it('Campus & settings', async () => {
    await renderApp('/admin/settings', ADMIN);
    await screen.findByRole('switch', { name: /phone numbers/ });
    await expect(document.body).toBeAccessible();
  });
});
