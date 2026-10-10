import type { BackendConnection } from '@compintel/contracts';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from '../api/auth-token.js';
import { resetApiTransport } from '../api/client.js';
import { SessionGate } from '../app/App.js';
import { installationFor } from '../app/installation.js';
import { navFor } from '../app/nav.js';
import { installFakeApi } from '../testing/fake-api.js';
import { renderWithProviders } from '../testing/render.js';
import { markJustSetUp } from './first-run.js';

/**
 * The student edition in the app (WP-34, R132–R135): the guest needs no sign-in
 * on Myself, is one button away on an institution, has no Lock, and can become
 * a profile from the user menu.
 */

vi.setConfig({ testTimeout: 20_000 });
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  setAuthToken(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(undefined);
});

async function openUserMenu(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: 'Guest' }));
  return screen.getByRole('menu');
}

describe('Myself (R133)', () => {
  it('opens straight into the app as the guest, with Teammates and no Lock', async () => {
    const api = installFakeApi({ studentMode: 'STUDENT_INDIVIDUAL' });
    const user = userEvent.setup();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).toBeNull();
    expect(api.calls.map((call) => call.path)).toContain('/api/v1/auth/guest');
    const rail = screen.getByRole('navigation', { name: 'Main' });
    expect(within(rail).getByRole('link', { name: 'Teammates' })).toBeInTheDocument();
    expect(within(rail).queryByRole('link', { name: 'Students' })).toBeNull();

    const menu = await openUserMenu(user);
    expect(within(menu).queryByRole('menuitem', { name: 'Lock' })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: 'Sign out' })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Create my profile/ })).toBeInTheDocument();
  });

  it('turns the guest into a profile from the user menu', async () => {
    const api = installFakeApi({ studentMode: 'STUDENT_INDIVIDUAL' });
    const user = userEvent.setup();
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    const menu = await openUserMenu(user);
    await user.click(within(menu).getByRole('menuitem', { name: /Create my profile/ }));

    const dialog = screen.getByRole('dialog', { name: 'Create my profile' });
    expect(within(dialog).queryByText(/Take what Guest made/)).toBeNull();
    await user.type(within(dialog).getByLabelText('Your name'), 'Asha Rao');
    await user.type(within(dialog).getByLabelText('E-mail'), 'asha@example.com');
    await user.type(within(dialog).getByLabelText('Password'), 'asha-long-password');
    await user.type(within(dialog).getByLabelText('Password again'), 'asha-long-password');
    await user.click(within(dialog).getByRole('button', { name: 'Create profile' }));

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Create my profile' })).toBeNull();
    });
    const sent = api.calls.find((call) => call.path === '/api/v1/me/profile');
    expect(sent?.body).toStrictEqual({
      displayName: 'Asha Rao',
      email: 'asha@example.com',
      password: 'asha-long-password',
      takeGuestData: false,
    });
  });
});

describe('An institution (R134)', () => {
  it('offers Continue as guest next to the profile sign-in', async () => {
    installFakeApi({ studentMode: 'STUDENT_INSTITUTION' });
    const user = userEvent.setup();
    renderWithProviders(<SessionGate connection={CONNECTION} />);

    await user.click(await screen.findByRole('button', { name: 'Continue as guest' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
    // A walk-in guest is a plain student: no admin section at all.
    expect(screen.queryByRole('navigation', { name: 'Administration' })).toBeNull();
  });

  it('skips the sign-in screen once, right after the wizard', async () => {
    installFakeApi({ studentMode: 'STUDENT_INSTITUTION' });
    markJustSetUp();
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument();
  });
});

describe('a department install', () => {
  it('offers no guest', async () => {
    installFakeApi();
    renderWithProviders(<SessionGate connection={CONNECTION} />);
    expect(await screen.findByLabelText('Password')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Continue as guest' })).toBeNull();
    });
  });
});

describe('the words and the rail (R135)', () => {
  it('says Teammates and Owner on a student install, and Students and mentor otherwise', () => {
    expect(installationFor('STUDENT_INSTITUTION').labels).toMatchObject({
      students: 'Teammates',
      primaryMentor: 'Owner',
    });
    expect(installationFor(undefined).labels).toMatchObject({
      students: 'Students',
      primaryMentor: 'Primary mentor',
    });
    expect(installationFor('STUDENT_INDIVIDUAL').grantableRoles).not.toContain('PROFESSOR');
    expect(installationFor('DEPARTMENT').grantableRoles).not.toContain('STUDENT');
  });

  it('keeps Sources and Settings for Myself, and adds Members for an institution', () => {
    expect(navFor('STUDENT_INDIVIDUAL').admin.map((item) => item.label)).toStrictEqual([
      'Sources & scraper',
      'Settings',
    ]);
    expect(navFor('STUDENT_INSTITUTION').admin.map((item) => item.label)).toStrictEqual([
      'Members',
      'Sources & scraper',
      'Settings',
    ]);
    expect(navFor('DEPARTMENT').admin).toHaveLength(8);
  });
});
