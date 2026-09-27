import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import {
  fillTo,
  installWizardApi,
  installWizardShell,
  nextStep,
  renderWizard,
} from '../../testing/wizard.js';

/**
 * Every step of the wizard, checked with axe (the §19 criterion; ruling R89's
 * `pnpm test:a11y`).
 *
 * Five passes, and each one has to be walked to — the wizard cannot be skipped
 * (R39), so reaching the recovery step means filling in nine steps' worth of
 * fields first. That is what made this the second-slowest file in `pnpm verify`
 * and why the whole suite had carried a 30-second per-test timeout.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

vi.setConfig({ testTimeout: 20_000 });

beforeEach(() => {
  invoke.mockReset();
  resetApiTransport();
  installWizardApi();
  installWizardShell(invoke);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('accessibility (the §19 criterion)', () => {
  it.each([
    ['welcome', (): Promise<void> => Promise.resolve()],
    ['organization', async (): Promise<void> => nextStep(/Get started/)],
    ['campus', async (): Promise<void> => fillTo('campus').then(() => nextStep())],
    ['folders', async (): Promise<void> => fillTo('folders').then(() => nextStep())],
  ])('has no axe violations on %s', async (_name, reach) => {
    renderWizard();
    await reach();
    await expect(document.body).toBeAccessible();
  });

  it('has no axe violations on the recovery step', async () => {
    renderWizard();
    await fillTo('submit');
    await nextStep(/Set up CompIntel/);
    await screen.findByRole('heading', { name: 'Save your recovery material' });
    await expect(document.body).toBeAccessible();
  });
});
