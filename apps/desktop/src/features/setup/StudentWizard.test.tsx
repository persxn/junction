import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../api/client.js';
import { takeJustSetUp } from '../../auth/first-run.js';
import { nextStep, renderWizard, typeInto, wizardUser } from '../../testing/wizard.js';

/**
 * The student half of the first-run wizard (WP-34, R130, R133, R134): four
 * screens, no password anywhere, and the request the backend's union expects.
 */

vi.setConfig({ testTimeout: 20_000 });
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));

const sent: unknown[] = [];

function installStudentApi(): void {
  sent.length = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const parsed = new URL(url);
      const json = (status: number, body: unknown): Response =>
        ({
          ok: status >= 200 && status < 300,
          status,
          text: () => Promise.resolve(JSON.stringify(body)),
        }) as unknown as Response;
      if (parsed.pathname === '/api/v1/setup/places') {
        return Promise.resolve(
          json(200, {
            places: [
              {
                label: 'Kolkata, West Bengal',
                kind: 'CITY',
                lat: 22.5726,
                lon: 88.3639,
                precision: 'CITY',
              },
              {
                label: 'Example Institute of Technology, Kolkata',
                kind: 'INSTITUTION',
                lat: 22.5,
                lon: 88.4,
                precision: 'CAMPUS',
              },
            ],
          }),
        );
      }
      if (parsed.pathname === '/api/v1/setup/complete') {
        sent.push(JSON.parse((init?.body ?? '{}') as string));
        return Promise.resolve(json(200, {}));
      }
      return Promise.resolve(json(404, {}));
    }),
  );
}

beforeEach(() => {
  resetApiTransport();
  installStudentApi();
  takeJustSetUp();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function chooseStudent(representing: RegExp): Promise<void> {
  await nextStep(/Get started/);
  await wizardUser().click(screen.getByRole('radio', { name: /A student/ }));
  await wizardUser().click(screen.getByRole('radio', { name: representing }));
  await nextStep(/Next/);
}

describe('Myself', () => {
  it('reaches the app in four screens with no password typed', async () => {
    const { onFinished } = renderWizard();
    await chooseStudent(/Myself/);
    expect(screen.getByRole('heading', { name: 'About you' })).toBeInTheDocument();

    await typeInto('Where are you?', 'Kol');
    await wizardUser().click(await screen.findByRole('button', { name: /Kolkata, West Bengal/ }));
    expect(screen.getByText(/Using Kolkata, West Bengal/)).toBeInTheDocument();
    await nextStep(/Next/);

    expect(screen.getByRole('heading', { name: 'Contact address' })).toBeInTheDocument();
    expect(document.querySelector('input[type=password]')).toBeNull();
    await typeInto('Contact e-mail for event sites', 'asha@example.com');
    await nextStep(/Start using Junction/);

    await waitFor(() => {
      expect(onFinished).toHaveBeenCalled();
    });
    expect(sent).toStrictEqual([
      {
        mode: 'STUDENT_INDIVIDUAL',
        home: { label: 'Kolkata, West Bengal', lat: 22.5726, lon: 88.3639 },
        scraperContactEmail: 'asha@example.com',
      },
    ]);
    // The app opens as the guest, without a sign-in screen.
    expect(takeJustSetUp()).toBe(true);
  });

  it('will not move on without a place, and says why', async () => {
    renderWizard();
    await chooseStudent(/Myself/);
    await nextStep(/Next/);
    expect(screen.getByText(/Choose where you are/)).toBeInTheDocument();
    expect(sent).toHaveLength(0);
  });

  it('goes back to the audience question from its first step', async () => {
    renderWizard();
    await chooseStudent(/Myself/);
    await wizardUser().click(screen.getByRole('button', { name: 'Back' }));
    expect(
      screen.getByRole('heading', { name: 'Who is setting up Junction?' }),
    ).toBeInTheDocument();
  });
});

describe('An institution', () => {
  it('asks for the institution, the group and the campus, then sets up', async () => {
    renderWizard();
    await chooseStudent(/An institution/);
    await typeInto('Institution', 'Example Institute of Technology');
    await typeInto('Club, chapter or team', 'Coding Club');
    await nextStep(/Next/);

    await wizardUser().click(screen.getByRole('button', { name: 'Enter coordinates instead' }));
    await typeInto('Latitude', '22.5');
    await typeInto('Longitude', '88.4');
    await nextStep(/Next/);
    await typeInto('Contact e-mail for event sites', 'club@example.edu');
    await nextStep(/Start using Junction/);

    await waitFor(() => {
      expect(sent).toHaveLength(1);
    });
    expect(sent[0]).toStrictEqual({
      mode: 'STUDENT_INSTITUTION',
      organization: { name: 'Example Institute of Technology' },
      group: { name: 'Coding Club' },
      campus: { name: 'Example Institute of Technology', lat: 22.5, lon: 88.4 },
      scraperContactEmail: 'club@example.edu',
    });
  });
});

describe('the audience question', () => {
  it('will not continue until a student says whom they represent', async () => {
    renderWizard();
    await nextStep(/Get started/);
    await nextStep(/Next/);
    expect(screen.getByRole('alert')).toHaveTextContent('Tell Junction who is setting it up.');
    await wizardUser().click(screen.getByRole('radio', { name: /A student/ }));
    await nextStep(/Next/);
    expect(screen.getByRole('alert')).toHaveTextContent('Tell Junction whom you represent.');
  });
});
