import type { BackendConnection } from '@compintel/contracts';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { renderWithProviders } from '../../testing/render.js';
import { SetupWizard } from './SetupWizard.js';

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
 * second, but the full suite runs 69 files at once on this box and one of them
 * is hashing with Argon2id, so the default 5 s timeout turned this file into a
 * coin flip. The work is the same; only the budget is bigger.
 */
vi.setConfig({ testTimeout: 30_000 });

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

const DATA_DIR = 'C:\\CompIntel';

const RECOVERY = {
  recoveryCode: 'ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789-ABCDE',
  recoveryFileName: 'compintel-recovery-20260920.txt',
  recoveryFile: 'CompIntel — backup recovery material\n…',
};

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

/** The backend, as far as the wizard can tell. */
function api(
  options: { completeFails?: { code: string; title: string; detail: string } } = {},
): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      const json = (status: number, body: unknown): Response =>
        ({
          ok: status >= 200 && status < 300,
          status,
          text: () => Promise.resolve(JSON.stringify(body)),
        }) as unknown as Response;

      if (path === '/api/v1/setup/check-path') {
        const body = JSON.parse((init?.body ?? '{}') as string) as { path: string };
        return Promise.resolve(
          json(200, {
            ok: !body.path.includes('bad'),
            ...(body.path.includes('bad') ? { reason: 'NOT_WRITABLE' } : {}),
            resolvedPath: body.path,
            freeBytes: 250 * 1024 ** 3,
          }),
        );
      }
      if (path === '/api/v1/setup/complete') {
        if (options.completeFails !== undefined) {
          return Promise.resolve(
            json(422, {
              type: `urn:compintel:problem:${options.completeFails.code}`,
              ...options.completeFails,
              status: 422,
              requestId: '0199a0d4-0000-7000-8000-000000000001',
            }),
          );
        }
        return Promise.resolve(json(200, RECOVERY));
      }
      return Promise.resolve(json(404, {}));
    }),
  );
}

/** The shell's two dialogs. */
function shell(options: { folder?: string | null } = {}): void {
  invoke.mockImplementation((command: string, args?: { folder?: string; fileName?: string }) => {
    if (command === 'pick_folder') {
      return Promise.resolve(options.folder === undefined ? 'D:\\Backups' : options.folder);
    }
    if (command === 'save_text_file') {
      return Promise.resolve(`${String(args?.folder)}\\${String(args?.fileName)}`);
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
}

function render(onFinished = vi.fn()): { onFinished: ReturnType<typeof vi.fn> } {
  renderWithProviders(
    <SetupWizard connection={CONNECTION} dataDir={DATA_DIR} onFinished={onFinished} />,
  );
  return { onFinished };
}

// `delay: null` keeps a nine-step wizard's worth of typing under a second.
const user = (): ReturnType<typeof userEvent.setup> => userEvent.setup({ delay: null });

async function type(label: string | RegExp, value: string): Promise<void> {
  await user().type(screen.getByLabelText(label), value);
}

async function next(name = /Next|Get started|Set up CompIntel/): Promise<void> {
  await user().click(screen.getByRole('button', { name }));
}

/** Fills everything up to, but not including, the step named. */
async function fillTo(
  step: 'campus' | 'administrator' | 'contact' | 'folders' | 'passphrase' | 'submit',
): Promise<void> {
  await next(/Get started/);
  await type('Institution', 'Example Institute of Technology');
  await type('Department', 'Computer Science and Engineering');
  if (step === 'campus') {
    return;
  }
  await next();

  await type('Campus name', 'Main Campus');
  await type('Latitude', '10.7594');
  await type('Longitude', '78.8149');
  if (step === 'administrator') {
    return;
  }
  await next();

  await type('Your name', 'A. Administrator');
  await type('E-mail', 'admin@example.edu');
  await type('Password', 'an-admin-password');
  await type('Password again', 'an-admin-password');
  if (step === 'contact') {
    return;
  }
  await next();

  await type(/Contact e-mail/, 'compintel@example.edu');
  if (step === 'folders') {
    return;
  }
  await next();

  await user().click(screen.getByRole('button', { name: /Choose…/ }));
  await screen.findByText(/Looks good/);
  if (step === 'passphrase') {
    return;
  }
  await next();

  await type('Backup passphrase', 'a-different-passphrase');
  await type('Passphrase again', 'a-different-passphrase');
}

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
    expect(screen.getByRole('heading', { name: 'Welcome to CompIntel' })).toBeInTheDocument();
    // Nothing else is on screen: no rail, no top bar, no route to anywhere.
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });

  it('refuses to advance while a step is incomplete, and says why', async () => {
    render();
    await next(/Get started/);
    await next();

    expect(screen.getByRole('heading', { name: 'Your institution' })).toBeInTheDocument();
    expect(screen.getByText('Enter the name of your college or university.')).toBeInTheDocument();
    expect(screen.getByText('Enter the department that will run CompIntel.')).toBeInTheDocument();
  });

  it('will not leave the folder step until the backend approves the folder', async () => {
    render();
    await fillTo('folders');
    await next();

    // No folder picked yet.
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument();

    shell({ folder: 'D:\\bad-folder' });
    await user().click(screen.getByRole('button', { name: /Choose…/ }));
    await screen.findByText(/CompIntel cannot write there/);
    await next();
    expect(screen.getByRole('heading', { name: 'Folders' })).toBeInTheDocument();
  });

  it('shows the data folder read-only, because the shell fixed it (R43)', async () => {
    render();
    await fillTo('folders');
    await next();
    const dataDir = screen.getByLabelText('Data folder');
    expect(dataDir).toHaveValue(DATA_DIR);
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
        detail: 'The backup passphrase must be different from your CompIntel password.',
      },
    });
    render();
    await fillTo('submit');
    await next(/Set up CompIntel/);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That backup passphrase cannot be used',
    );
    expect(screen.getByRole('heading', { name: 'Backup passphrase' })).toBeInTheDocument();
  });
});

describe('the recovery step (rulings R41 and R42)', () => {
  async function reachRecovery(): Promise<void> {
    await fillTo('submit');
    await next(/Set up CompIntel/);
    await screen.findByRole('heading', { name: 'Save your recovery material' });
  }

  it('shows the code once and offers the file, with Finish disabled', async () => {
    render();
    await reachRecovery();

    expect(screen.getByText(RECOVERY.recoveryCode)).toBeInTheDocument();
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
      fileName: RECOVERY.recoveryFileName,
      contents: RECOVERY.recoveryFile,
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

describe('accessibility (the §19 criterion)', () => {
  it.each([
    ['welcome', (): Promise<void> => Promise.resolve()],
    ['organization', async (): Promise<void> => next(/Get started/)],
    ['campus', async (): Promise<void> => fillTo('campus').then(() => next())],
    ['folders', async (): Promise<void> => fillTo('folders').then(() => next())],
  ])('has no axe violations on %s', async (_name, reach) => {
    const { container } = renderWithProviders(
      <SetupWizard connection={CONNECTION} dataDir={DATA_DIR} onFinished={vi.fn()} />,
    );
    await reach();
    await expect(container).toBeAccessible();
  });

  it('has no axe violations on the recovery step', async () => {
    const { container } = renderWithProviders(
      <SetupWizard connection={CONNECTION} dataDir={DATA_DIR} onFinished={vi.fn()} />,
    );
    await fillTo('submit');
    await next(/Set up CompIntel/);
    await screen.findByRole('heading', { name: 'Save your recovery material' });
    await expect(container).toBeAccessible();
  });
});
