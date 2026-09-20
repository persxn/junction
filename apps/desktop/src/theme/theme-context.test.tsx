import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setSystemTheme } from '../testing/match-media.js';
import { ThemeProvider, useTheme } from './theme-context.js';
import { THEME_CHOICES, THEME_STORAGE_KEY } from './theme.js';

function Probe(): React.JSX.Element {
  const { choice, resolved, setChoice } = useTheme();
  return (
    <div>
      <p data-testid="state">
        {choice}/{resolved}
      </p>
      {THEME_CHOICES.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => {
            setChoice(value);
          }}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

function renderProbe(): void {
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  setSystemTheme('light');
});

describe('<ThemeProvider>', () => {
  it('follows prefers-color-scheme when the choice is "system"', () => {
    setSystemTheme('dark');
    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('system/dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('follows Windows changing theme while the app is open', () => {
    renderProbe();
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    act(() => {
      setSystemTheme('dark');
    });
    expect(screen.getByTestId('state')).toHaveTextContent('system/dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('lets an explicit choice override the system', async () => {
    setSystemTheme('dark');
    renderProbe();
    await userEvent.click(screen.getByRole('button', { name: 'light' }));

    expect(screen.getByTestId('state')).toHaveTextContent('light/light');
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');

    // …and Windows changing its mind no longer moves it.
    act(() => {
      setSystemTheme('dark');
    });
    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
  });

  it('survives a reload', async () => {
    const first = render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    first.unmount();

    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('dark/dark');
  });

  it('renders normally when localStorage throws on read and on write', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('site data is blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('site data is blocked');
    });

    renderProbe();
    expect(screen.getByTestId('state')).toHaveTextContent('system/light');

    await userEvent.click(screen.getByRole('button', { name: 'dark' }));
    // The choice still applies for this session; it just will not be remembered.
    expect(screen.getByTestId('state')).toHaveTextContent('dark/dark');
    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
  });

  it('refuses to be used without a provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
    quiet.mockRestore();
  });
});
