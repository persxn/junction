import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ConnectionScreen } from './ConnectionScreen.js';

const handlers = () => ({
  onRetry: vi.fn(),
  onOpenLogs: vi.fn(),
  onCopyDiagnostics: vi.fn(),
});

function renderScreen(
  phase: Parameters<typeof ConnectionScreen>[0]['phase'],
  message: string | null = null,
): ReturnType<typeof handlers> & { container: HTMLElement } {
  const callbacks = handlers();
  const { container } = render(
    <ConnectionScreen
      phase={phase}
      message={message}
      dataDir="C:\\Users\\x\\AppData\\Local\\CompIntel-dev"
      {...callbacks}
    />,
  );
  return { ...callbacks, container };
}

describe('<ConnectionScreen> (ruling R26)', () => {
  it('gives DATA_DIR_LOCKED its own copy', () => {
    renderScreen('FAILED', 'DATA_DIR_LOCKED: another process holds backend.lock (pid 4242)');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Another CompIntel is already using this data folder',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Close the other CompIntel window');
  });

  it('gives DB_CORRUPT its own copy, pointing at a backup', () => {
    renderScreen('FAILED', 'DB_CORRUPT: PRAGMA quick_check failed');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'The database could not be opened',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Restore the most recent backup');
  });

  it('tells MIGRATION_FAILED that nothing was half-applied', () => {
    renderScreen('FAILED', 'MIGRATION_FAILED: 0002_events could not be applied');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'The database could not be upgraded',
    );
    expect(screen.getByRole('alert')).toHaveTextContent('nothing was half-applied');
  });

  it('shows an unnamed failure verbatim', () => {
    renderScreen('FAILED', 'the backend exited with code 3221225781');
    expect(screen.getByRole('alert')).toHaveTextContent('the backend exited with code 3221225781');
  });

  it('offers all three buttons, and only enables Retry when it can help', async () => {
    const user = userEvent.setup();
    const failed = renderScreen('FAILED', 'DB_CORRUPT: quick_check failed');

    const retry = screen.getByRole('button', { name: /Try again/ });
    const logs = screen.getByRole('button', { name: /Open logs/ });
    const copy = screen.getByRole('button', { name: 'Copy diagnostics' });
    expect(retry).toBeEnabled();

    await user.click(retry);
    await user.click(logs);
    await user.click(copy);
    expect(failed.onRetry).toHaveBeenCalledTimes(1);
    expect(failed.onOpenLogs).toHaveBeenCalledTimes(1);
    expect(failed.onCopyDiagnostics).toHaveBeenCalledTimes(1);
  });

  it('waits quietly while the backend is starting', () => {
    renderScreen('STARTING');
    expect(screen.getByRole('status')).toHaveTextContent('Starting CompIntel');
    expect(screen.getByRole('button', { name: /Try again/ })).toBeDisabled();
  });

  it('says a crash is being recovered from, not that everything is broken', () => {
    renderScreen('RESTARTING', 'the backend exited unexpectedly');
    expect(screen.getByRole('status')).toHaveTextContent('Reconnecting');
    expect(screen.getByRole('status')).toHaveTextContent('resume by themselves');
  });

  it('names the data folder the message is about', () => {
    renderScreen('FAILED', 'DATA_DIR_LOCKED');
    expect(screen.getByText(/CompIntel-dev/)).toBeInTheDocument();
  });

  it.each(['STARTING', 'RESTARTING', 'FAILED'] as const)(
    'has no axe violations in %s',
    async (phase) => {
      renderScreen(phase, 'DATA_DIR_LOCKED: pid 4242');
      await expect(document.body).toBeAccessible();
    },
  );
});
