import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resetApiTransport } from '../../../api/client.js';
import { renderApp } from '../../../testing/render.js';
import { installStudentsApi, type StudentsApi } from '../../../testing/students-api.js';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve(undefined)),
  isTauri: () => false,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(() => Promise.resolve(() => undefined)) }));
vi.setConfig({ testTimeout: 20_000 });

let api: StudentsApi;
beforeEach(() => {
  localStorage.clear();
  resetApiTransport();
  api = installStudentsApi();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const CSV = new File(
  ['Roll No,Name,Programme,Hostel\nNEW0001,New One,B.Tech,A\n'],
  'cse-2027.csv',
  { type: 'text/csv' },
);

async function choose(file: File = CSV): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup({ applyAccept: false });
  await renderApp('/students/import');
  await user.click(await screen.findByRole('button', { name: 'Choose a file…' }));
  const input = document.querySelector<HTMLInputElement>('input[type=file]');
  expect(input).not.toBeNull();
  await user.upload(input!, file);
  return user;
}

describe('the guide', () => {
  it('lists the accepted columns from the same list the server uses', async () => {
    await renderApp('/students/import');
    const table = await screen.findByRole('table', { name: 'Accepted columns' });
    const roll = within(table)
      .getByRole('rowheader', { name: /Roll number/ })
      .closest('tr')!;
    expect(roll).toHaveTextContent('Roll No');
    expect(roll).toHaveTextContent('Enrolment');
    expect(roll).toHaveTextContent('required');
    expect(
      within(table)
        .getByRole('rowheader', { name: /Skills/ })
        .closest('tr'),
    ).toHaveTextContent('Python:3');
  });
});

describe('importing', () => {
  it('checks the file, shows the problems beside the values, and imports the rest', async () => {
    const user = await choose();
    expect(await screen.findByRole('heading', { name: 'What will happen' })).toBeInTheDocument();
    expect(api.calls.find((call) => call.path.endsWith('/import/preview'))?.body).toMatchObject({
      fileName: 'cse-2027.csv',
      base64: expect.any(String) as string,
    });
    // A heading it does not know is "Not imported", never guessed.
    expect(screen.getByLabelText('Import “Hostel” as')).toHaveDisplayValue('Not imported');
    // With errors present the table opens on them, the message under the value.
    expect(screen.getByRole('button', { name: 'Rows with errors (1)' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Diploma').closest('td')).toHaveTextContent('is not a programme');

    const importButton = screen.getByRole('button', { name: 'Import 2 rows' });
    expect(importButton).toBeDisabled();
    await user.click(screen.getByLabelText(/new students have been shown the privacy notice/));
    expect(importButton).toBeEnabled();
    await user.click(importButton);

    expect(await screen.findByRole('heading', { name: 'Import finished' })).toBeInTheDocument();
    expect(screen.getByText('2 new students added')).toBeInTheDocument();
    expect(screen.getByText('1 rows with errors were not imported')).toBeInTheDocument();
    expect(api.calls.find((call) => call.path.endsWith('/import/commit'))?.body).toEqual({
      previewId: 'preview-0123456789abcdef',
      mentorMe: true,
      privacyNoticeShown: true,
    });
  });

  it('re-checks with a changed mapping before allowing the import', async () => {
    const user = await choose();
    await screen.findByRole('heading', { name: 'What will happen' });
    await user.selectOptions(screen.getByLabelText('Import “Hostel” as'), 'Notes');
    expect(screen.queryByRole('heading', { name: 'What will happen' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Check again with these columns' }));
    await screen.findByRole('heading', { name: 'What will happen' });
    const previews = api.calls.filter((call) => call.path.endsWith('/import/preview'));
    expect(previews).toHaveLength(2);
    expect(previews[1]?.body?.mapping).toContainEqual({ index: 3, field: 'notes' });
  });

  it('refuses a file of the wrong kind without sending it', async () => {
    await choose(new File(['x'], 'list.pdf'));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Only .csv and .xlsx files can be imported.',
    );
    expect(api.calls.filter((call) => call.path.endsWith('/import/preview'))).toHaveLength(0);
  });

  it('says plainly when the preview has expired', async () => {
    api = installStudentsApi({ previewExpired: true });
    const user = await choose();
    await screen.findByRole('heading', { name: 'What will happen' });
    await user.click(screen.getByLabelText(/new students have been shown the privacy notice/));
    await user.click(screen.getByRole('button', { name: 'Import 2 rows' }));
    await waitFor(() => {
      expect(screen.getByText(/more than 30 minutes old/)).toBeInTheDocument();
    });
  });
});
