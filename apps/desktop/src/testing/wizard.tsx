import type { BackendConnection } from '@compintel/contracts';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, type Mock } from 'vitest';

import { SetupWizard } from '../features/setup/SetupWizard.js';
import { renderWithProviders } from './render.js';

/**
 * Driving the first-run wizard (rulings R39–R44), for the two suites that do it.
 *
 * Extracted when ruling R89 moved the wizard's axe passes into their own project:
 * both suites walk the same nine steps with the same values, and two copies of a
 * hundred keystrokes would drift the moment a field was renamed.
 */

export const WIZARD_CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

export const WIZARD_DATA_DIR = 'C:\\Junction';

export const WIZARD_RECOVERY = {
  recoveryCode: 'ABCDE-FGHJK-MNPQR-STVWX-YZ234-56789-ABCDE',
  recoveryFileName: 'junction-recovery-20260920.txt',
  recoveryFile: 'Junction — backup recovery material\n…',
};

export interface WizardApiOptions {
  readonly completeFails?: { code: string; title: string; detail: string };
}

/** The backend, as far as the wizard can tell. */
export function installWizardApi(options: WizardApiOptions = {}): void {
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
        return Promise.resolve(json(200, WIZARD_RECOVERY));
      }
      return Promise.resolve(json(404, {}));
    }),
  );
}

/**
 * The shell's two dialogs. The mock itself belongs to the test file, because
 * `vi.mock` is per module graph, so it is passed in rather than made here.
 */
export function installWizardShell(invoke: Mock, options: { folder?: string | null } = {}): void {
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

export function renderWizard(onFinished: Mock = vi.fn()): { onFinished: Mock } {
  renderWithProviders(
    <SetupWizard
      connection={WIZARD_CONNECTION}
      dataDir={WIZARD_DATA_DIR}
      onFinished={onFinished}
    />,
  );
  return { onFinished };
}

// `delay: null` keeps a nine-step wizard's worth of typing under a second.
export const wizardUser = (): ReturnType<typeof userEvent.setup> =>
  userEvent.setup({ delay: null });

export async function typeInto(label: string | RegExp, value: string): Promise<void> {
  await wizardUser().type(screen.getByLabelText(label), value);
}

export async function nextStep(
  name: string | RegExp = /Next|Get started|Set up Junction/,
): Promise<void> {
  await wizardUser().click(screen.getByRole('button', { name }));
}

/** Fills everything up to, but not including, the step named. */
export async function fillTo(
  step: 'campus' | 'administrator' | 'contact' | 'folders' | 'passphrase' | 'submit',
): Promise<void> {
  await nextStep(/Get started/);
  await typeInto('Institution', 'Example Institute of Technology');
  await typeInto('Department', 'Computer Science and Engineering');
  if (step === 'campus') {
    return;
  }
  await nextStep();

  await typeInto('Campus name', 'Main Campus');
  await typeInto('Latitude', '10.7594');
  await typeInto('Longitude', '78.8149');
  if (step === 'administrator') {
    return;
  }
  await nextStep();

  await typeInto('Your name', 'A. Administrator');
  await typeInto('E-mail', 'admin@example.edu');
  await typeInto('Password', 'an-admin-password');
  await typeInto('Password again', 'an-admin-password');
  if (step === 'contact') {
    return;
  }
  await nextStep();

  await typeInto(/Contact e-mail/, 'compintel@example.edu');
  if (step === 'folders') {
    return;
  }
  await nextStep();

  await wizardUser().click(screen.getByRole('button', { name: /Choose…/ }));
  await screen.findByText(/Looks good/);
  if (step === 'passphrase') {
    return;
  }
  await nextStep();

  await typeInto('Backup passphrase', 'a-different-passphrase');
  await typeInto('Passphrase again', 'a-different-passphrase');
}
