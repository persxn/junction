import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { renderWithProviders } from '../testing/render.js';
import { EmptyState } from './EmptyState.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { Skeleton, SKELETON_DELAY_MS } from './Skeleton.js';
import { useToast } from './toast/ToastProvider.js';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('<ErrorBoundary> (§16.3)', () => {
  function Boom({ shouldThrow }: { readonly shouldThrow: boolean }): React.JSX.Element {
    if (shouldThrow) {
      throw new Error('the dashboard query blew up');
    }
    return <p>the screen</p>;
  }

  it('catches a throwing child and says what happened', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary label="the dashboard">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Something went wrong in the dashboard');
    expect(alert).toHaveTextContent('the dashboard query blew up');
  });

  it('says when the data was last good', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const lastGood = new Date(Date.now() - 5 * 60_000);
    render(
      <ErrorBoundary label="the dashboard" lastGoodAt={lastGood}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Last good data: 5 minutes ago');
  });

  it('says so plainly when nothing had loaded', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render(
      <ErrorBoundary label="the dashboard">
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing had loaded yet');
  });

  it('offers a retry that re-renders the child and calls back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const user = userEvent.setup();
    const onRetry = vi.fn();

    function Harness(): React.JSX.Element {
      const [failing, setFailing] = useState(true);
      return (
        <ErrorBoundary
          label="the dashboard"
          onRetry={() => {
            onRetry();
            setFailing(false);
          }}
        >
          <Boom shouldThrow={failing} />
        </ErrorBoundary>
      );
    }

    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('the screen')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { container } = render(
      <ErrorBoundary label="the dashboard" lastGoodAt={new Date()}>
        <Boom shouldThrow />
      </ErrorBoundary>,
    );
    await expect(container).toBeAccessible();
  });
});

describe('<Skeleton> (§16.3: loads over 150 ms)', () => {
  it('shows nothing before the threshold', () => {
    vi.useFakeTimers();
    render(<Skeleton />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
    });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('appears once the wait is long enough to admit to', () => {
    vi.useFakeTimers();
    render(<Skeleton label="Loading events" />);

    act(() => {
      vi.advanceTimersByTime(SKELETON_DELAY_MS);
    });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(status).toHaveTextContent('Loading events');
  });

  it('waits 150 ms, as §16.3 says', () => {
    expect(SKELETON_DELAY_MS).toBe(150);
  });
});

describe('<EmptyState> (§16.3: always name the next action)', () => {
  it('names the action and runs it', async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(
      <EmptyState
        title="No saved searches"
        description="Saved searches tell you when something new matches."
        action={{ label: 'Create one', onAction }}
      />,
    );

    expect(screen.getByRole('heading', { name: 'No saved searches' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Create one' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });
});

describe('the toast system (§16.3)', () => {
  function Trigger(): React.JSX.Element {
    const toast = useToast();
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            toast.show({ title: 'Event hidden', tone: 'success' });
          }}
        >
          hide
        </button>
        <button
          type="button"
          onClick={() => {
            toast.show({
              title: 'Event hidden',
              description: 'It will not appear in Discover.',
              action: { label: 'Undo', onAction: undone },
            });
          }}
        >
          hide with undo
        </button>
      </div>
    );
  }
  const undone = vi.fn();

  it('announces a toast in a polite live region', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Trigger />);

    await user.click(screen.getByRole('button', { name: 'hide' }));
    const region = screen.getByRole('status', { name: 'Notifications' });
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent('Event hidden');
    // §16.3: never colour alone — the tone is spelled out for a screen reader.
    expect(region).toHaveTextContent('Success:');
  });

  it('can be dismissed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Trigger />);

    await user.click(screen.getByRole('button', { name: 'hide' }));
    await user.click(screen.getByRole('button', { name: 'Dismiss: Event hidden' }));
    expect(screen.queryByText('Event hidden')).toBeNull();
  });

  it('carries an Undo slot that fires once and closes the toast', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Trigger />);

    await user.click(screen.getByRole('button', { name: 'hide with undo' }));
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    expect(undone).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('It will not appear in Discover.')).toBeNull();
  });

  it('goes away on its own', () => {
    // fireEvent rather than userEvent: userEvent's own timing does not mix well
    // with fake timers, and the point here is only the dismissal clock.
    vi.useFakeTimers();
    renderWithProviders(<Trigger />);

    fireEvent.click(screen.getByRole('button', { name: 'hide' }));
    expect(screen.getByText('Event hidden')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.queryByText('Event hidden')).toBeNull();
  });

  it('keeps an actionable toast up longer, so Undo can be reached', () => {
    vi.useFakeTimers();
    renderWithProviders(<Trigger />);

    fireEvent.click(screen.getByRole('button', { name: 'hide with undo' }));
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('has no axe violations', async () => {
    const user = userEvent.setup();
    const { container } = renderWithProviders(<Trigger />);
    await user.click(screen.getByRole('button', { name: 'hide with undo' }));
    await expect(container).toBeAccessible();
  });
});
