import type { Appearance, BackendConnection } from '@compintel/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from '../../api/auth-token.js';
import { resetApiTransport } from '../../api/client.js';
import { SessionGate } from '../../app/App.js';
import { installFakeApi } from '../../testing/fake-api.js';
import { renderWithProviders } from '../../testing/render.js';
import {
  installWizardApi,
  nextStep,
  WIZARD_CONNECTION,
  WIZARD_DATA_DIR,
} from '../../testing/wizard.js';
import { cacheAppearance } from '../../theme/appearance.js';
import { AppearanceProvider } from '../../theme/appearance-context.js';
import { SetupWizard } from './SetupWizard.js';

/**
 * WP-34's new screens under axe (ruling R89), at CALM and SHOWCASE: the audience
 * question, the student's first step, the sign-in screen with "Continue as
 * guest", and "Create my profile".
 */

vi.setConfig({ testTimeout: 20_000 });
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const CONNECTION: BackendConnection = WIZARD_CONNECTION;

const tier = (effects: Appearance['effects']): Appearance => ({
  flavourLight: 'latte',
  flavourDark: 'mocha',
  effects,
  rgbPreset: { preset: effects === 'SHOWCASE' ? 'AURORA' : 'OFF', speed: 'MEDIUM' },
});

beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  setAuthToken(undefined);
});
afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(undefined);
});

function render(ui: React.ReactNode, effects: Appearance['effects']): void {
  cacheAppearance(tier(effects));
  renderWithProviders(<AppearanceProvider>{ui}</AppearanceProvider>);
}

describe.each(['CALM', 'SHOWCASE'] as const)('the student edition at %s', (effects) => {
  it('has no axe violations on the audience question', async () => {
    installWizardApi();
    render(
      <SetupWizard connection={CONNECTION} dataDir={WIZARD_DATA_DIR} onFinished={vi.fn()} />,
      effects,
    );
    await nextStep(/Get started/);
    await userEvent.setup().click(screen.getByRole('radio', { name: /A student/ }));
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations on the first student step', async () => {
    installWizardApi();
    render(
      <SetupWizard connection={CONNECTION} dataDir={WIZARD_DATA_DIR} onFinished={vi.fn()} />,
      effects,
    );
    const user = userEvent.setup();
    await nextStep(/Get started/);
    await user.click(screen.getByRole('radio', { name: /A student/ }));
    await user.click(screen.getByRole('radio', { name: /Myself/ }));
    await nextStep(/Next/);
    await user.click(screen.getByRole('button', { name: 'Enter coordinates instead' }));
    await screen.findByRole('heading', { name: 'About you' });
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations on the sign-in screen that offers the guest', async () => {
    installFakeApi({ studentMode: 'STUDENT_INSTITUTION' });
    render(<SessionGate connection={CONNECTION} />, effects);
    await screen.findByRole('button', { name: 'Continue as guest' });
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations on Create my profile', async () => {
    installFakeApi({ studentMode: 'STUDENT_INSTITUTION' });
    render(<SessionGate connection={CONNECTION} />, effects);
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Continue as guest' }));
    await user.click(await screen.findByRole('button', { name: 'Guest' }));
    await user.click(
      within(screen.getByRole('menu')).getByRole('menuitem', { name: /Create my profile/ }),
    );
    await screen.findByRole('dialog', { name: 'Create my profile' });
    await expect(document.body).toBeAccessible();
  });
});
