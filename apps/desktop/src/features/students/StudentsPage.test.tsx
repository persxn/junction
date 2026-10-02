import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { TEST_USER } from '../../testing/auth.js';
import { renderApp } from '../../testing/render.js';
import {
  installStudentsApi,
  makeStudent,
  mentoredBy,
  type StudentsApi,
} from '../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

const STUDENTS = Array.from({ length: 60 }, (_unused, index) =>
  makeStudent(index + 1, {
    fullName: `Demo Student ${String(index + 1).padStart(2, '0')}`,
    ...(index === 0 ? { mentors: [mentoredBy(TEST_USER.id, TEST_USER.displayName)] } : {}),
    ...(index === 1 ? { status: 'INACTIVE' as const } : {}),
  }),
);

let api: StudentsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  api = installStudentsApi({ students: STUDENTS });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const rows = (): HTMLElement[] => within(screen.getByRole('table')).getAllByRole('row').slice(1);

async function openList(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await renderApp('/students');
  await screen.findByText('Demo Student 01');
  return user;
}

describe('the student list', () => {
  it('shows 50 a page with the total, then Load more appends the rest', async () => {
    const user = await openList();
    expect(rows()).toHaveLength(50);
    expect(screen.getByText('60 students.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() => {
      expect(rows()).toHaveLength(60);
    });
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('marks my students, and statuses as words', async () => {
    await openList();
    expect(within(rows()[0]!).getByText('Mine')).toBeInTheDocument();
    expect(within(rows()[1]!).getByText('Inactive')).toBeInTheDocument();
  });

  it('"My students" asks the server for mine only', async () => {
    const user = await openList();
    await user.click(screen.getByRole('button', { name: 'My students' }));
    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(api.calls.some((call) => call.query.includes('mine=true'))).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Clear filters' }));
    await waitFor(() => {
      expect(rows()).toHaveLength(50);
    });
  });

  it('J/K move between rows and Enter opens the student', async () => {
    const user = await openList();
    await user.keyboard('j');
    expect(rows()[1]).toHaveFocus();
    await user.keyboard('k');
    expect(rows()[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(
      await screen.findByRole('heading', { level: 1, name: /Demo Student 01/ }),
    ).toBeInTheDocument();
  });

  it('suggests importing when there are no students at all', async () => {
    installStudentsApi({ students: [] });
    await renderApp('/students');
    expect(await screen.findByText('No students yet')).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Import a list' }).length +
        screen.getAllByRole('link', { name: /Import a list/ }).length,
    ).toBeGreaterThan(1);
  });
});

describe('the guide', () => {
  it('explains the screen, and stays closed once closed', async () => {
    const user = await openList();
    const toggle = screen.getByRole('button', { name: /How the student list works/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/Every professor sees and can edit every student/)).toBeInTheDocument();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Every professor sees and can edit every student/)).toBeNull();
    expect(localStorage.getItem('ci.guide.students-list.closed')).toBe('1');
  });
});
