import { screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import {
  fillTo,
  installWizardApi,
  installWizardShell,
  nextStep,
  renderWizard,
  startAsDepartment,
  wizardUser,
  WIZARD_DATA_DIR,
  WIZARD_RECOVERY,
} from '../../testing/wizard.js';

/**
 * The wizard, driven the way a person drives it (rulings R39–R44).
 *
 * The two assertions the §19 acceptance criteria name are here: there is no way
 * to skip a step, and Finish stays disabled until the recovery file has really
 * been exported.
 */

/**
 * Every case here drives the whole nine-step wizard through `userEvent`, which
 * is ~a hundred keystrokes and a re-render each. Alone that takes well under a
 * second, but the full suite runs sixty-odd files at once on this box and one of
 * them is hashing with Argon2id, so the default 5 s timeout turned this file into
 * a coin flip. Twenty seconds is the ceiling ruling R89 allows, and it was the
 * axe passes — now in `SetupWizard.a11y.test.tsx` — that had pushed it past it.
 */
vi.setConfig({ testTimeout: 20_000 });

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

/** Everything that drives the wizard lives in `testing/wizard.tsx` (ruling R89). */
const api = installWizardApi;
const render = renderWizard;
const user = wizardUser;
const next = nextStep;
const shell = (options: { folder?: string | null } = {}): void =>
  installWizardShell(invoke, options);

beforeEach(() => {
  invoke.mockReset();
  resetApiTransport();
  api();
  shell();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the wizard cannot be skipped (the §19 criterion)', () => {
  it('opens on Welcome with no way past it but Get started', () => {
    render();
    expect(screen.getByRole('heading', { name: 'Welcome to Junction' })).toBeInTheDocument();
    // Nothing else is on screen: no rail, no top bar, no route to anywhere.
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('refuses to advance while a step is incomplete, and says why', async () => {
    render();
    await startAsDepartment();
    await next();

    expect(screen.getByRole('heading', { name: 'Your institution' })).toBeInTheDocument();
    expect(screen.getByText('Enter the name of your college or university.')).toBeInTheDocument();
    expect(screen.getByText('Enter the department that will run Junction.')).toBeInTheDocument();
  });

  it('will not leave the folder step until the backend approves the folder', async () => {
    render();
    await fillTo('folders');
    await next();

    // No folder picked yet.
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument();

    shell({ folder: 'D:\\bad-folder' });
    await user().click(screen.getByRole('button', { name: /Choose…/ }));
    await screen.findByText(/Junction cannot write there/);
    await next();
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument();
  });

  it('shows the data folder read-only, because the shell fixed it (R43)', async () => {
    render();
    await fillTo('folders');
    await next();
    const dataDir = screen.getByLabelText('Data folder');
    expect(dataDir).toHaveValue(WIZARD_DATA_DIR);
    expect(dataDir).toHaveAttribute('readonly');
  });
});

describe('going back', () => {
  it('keeps what was already entered', async () => {
    render();
    await fillTo('campus');
    await next();
    await user().click(screen.getByRole('button', { name: 'Back' }));

    expect(screen.getByLabelText('Institution')).toHaveValue('Example Institute of Technology');
    expect(screen.getByLabelText('Department')).toHaveValue('Computer Science and Engineering');
  });
});

describe('what the server refuses', () => {
  it('shows the problem and stays on the passphrase step', async () => {
    api({
      completeFails: {
        code: 'SETUP_PASSPHRASE_WEAK',
        title: 'That backup passphrase cannot be used',
        detail: 'The backup passphrase must be different from your Junction password.',
      },
    });
    render();
    await fillTo('submit');
    await next(/Set up Junction/);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That backup passphrase cannot be used',
    );
    expect(screen.getByRole('heading', { name: 'Backup passphrase' })).toBeInTheDocument();
  });
});

describe('the recovery step (rulings R41 and R42)', () => {
  async function reachRecovery(): Promise<void> {
    await fillTo('submit');
    await next(/Set up Junction/);
    await screen.findByRole('heading', { name: 'Save your recovery material' });
  }

  it('shows the code once and offers the file, with Finish disabled', async () => {
    render();
    await reachRecovery();

    expect(screen.getByText(WIZARD_RECOVERY.recoveryCode)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /I have saved both/ })).toBeDisabled();
    // There is no way back: the installation has already been written.
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('keeps Finish disabled until the file is exported AND both boxes are ticked', async () => {
    render();
    await reachRecovery();
    const finish = screen.getByRole('button', { name: /I have saved both/ });

    // The second checkbox cannot even be ticked before the file is saved.
    const fileBox = screen.getByRole('checkbox', { name: /recovery file somewhere other/ });
    expect(fileBox).toBeDisabled();

    await user().click(screen.getByRole('checkbox', { name: /recovery code somewhere safe/ }));
    expect(finish).toBeDisabled();

    await user().click(screen.getByRole('button', { name: /Save recovery file…/ }));
    await screen.findByText(/Saved to D:\\Backups/);
    expect(finish).toBeDisabled();

    await user().click(fileBox);
    expect(finish).toBeEnabled();
  });

  it('writes the file through the shell, into the folder that was picked', async () => {
    render();
    await reachRecovery();
    await user().click(screen.getByRole('button', { name: /Save recovery file…/ }));
    await screen.findByText(/Saved to/);

    expect(invoke).toHaveBeenCalledWith('save_text_file', {
      folder: 'D:\\Backups',
      fileName: WIZARD_RECOVERY.recoveryFileName,
      contents: WIZARD_RECOVERY.recoveryFile,
      overwrite: true,
    });
  });

  it('says so when the shell refuses the write', async () => {
    render();
    await reachRecovery();
    invoke.mockImplementation((command: string) =>
      command === 'pick_folder'
        ? Promise.resolve('D:\\Backups')
        : Promise.reject(new Error('That folder was not chosen in the file dialog.')),
    );

    await user().click(screen.getByRole('button', { name: /Save recovery file…/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The recovery file could not be saved',
    );
    expect(screen.getByRole('checkbox', { name: /recovery file somewhere other/ })).toBeDisabled();
  });

  it('finishes into the done screen and then hands back to the app', async () => {
    const { onFinished } = render();
    await reachRecovery();

    await user().click(screen.getByRole('checkbox', { name: /recovery code somewhere safe/ }));
    await user().click(screen.getByRole('button', { name: /Save recovery file…/ }));
    await screen.findByText(/Saved to/);
    await user().click(screen.getByRole('checkbox', { name: /recovery file somewhere other/ }));
    await user().click(screen.getByRole('button', { name: /I have saved both/ }));

    expect(await screen.findByRole('heading', { name: 'You are ready' })).toBeInTheDocument();
    expect(screen.getByText(/admin@example.edu/)).toBeInTheDocument();
    expect(onFinished).not.toHaveBeenCalled();

    await user().click(screen.getByRole('button', { name: 'Sign in' }));
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});

describe('the step rail', () => {
  it('ticks the steps that are behind the user', async () => {
    render();
    await fillTo('campus');
    const rail = screen.getByRole('navigation', { name: 'Setup steps' });
    expect(within(rail).getByText('Your institution')).toBeInTheDocument();
    // Nothing is ticked on the first real step.
    expect(within(rail).queryByText('(done)')).toBeNull();

    await next();
    expect(within(rail).getAllByText('(done)')).toHaveLength(1);
  });
});

// The axe passes over each step live in `SetupWizard.a11y.test.tsx` (ruling R89).
