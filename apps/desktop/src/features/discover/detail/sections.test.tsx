import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ago, agoOrNever } from '../../../lib/ago.js';
import { isExternalUrl } from '../../../lib/external.js';
import { NOW } from '../../../testing/fake-search.js';
import { CategoryChips } from './CategoryChips.js';
import { ChangeHistory } from './ChangeHistory.js';
import { DeadlineTimeline } from './DeadlineTimeline.js';
import { FactsGrid } from './FactsGrid.js';
import { detailFixture, OLDER_HISTORY } from '../../../testing/event-detail.js';

/**
 * The drawer's sections, each on its own (§16.2), under a fake clock: every
 * relative time on this screen is measured from a `now` the caller passes, so
 * nothing here reads the real clock and "verified 2 h ago" is a fact rather
 * than a race.
 */

const HOUR = 3_600_000;
const DAY = 86_400_000;

describe('relative time (lib/ago)', () => {
  it('is the compact form §16.1 and §16.2 ask for', () => {
    expect(ago(NOW - 4 * 60_000, NOW)).toBe('4 min ago');
    expect(ago(NOW - 2 * HOUR, NOW)).toBe('2 h ago');
    expect(ago(NOW - 3 * DAY, NOW)).toBe('3 days ago');
    expect(ago(NOW - DAY, NOW)).toBe('1 day ago');
  });

  it('says "just now" rather than "0 min ago", and can look forwards', () => {
    expect(ago(NOW - 10_000, NOW)).toBe('just now');
    expect(ago(NOW + 30 * 60_000, NOW)).toBe('in 30 min');
  });

  it('says "never" rather than leaving a gap', () => {
    expect(agoOrNever(null, NOW)).toBe('never');
    expect(agoOrNever(NOW - 2 * HOUR, NOW)).toBe('2 h ago');
  });
});

describe('the facts grid and its provenance', () => {
  it('names the source and when it was verified, for a fact that has a claim', async () => {
    const user = userEvent.setup();
    render(<FactsGrid event={detailFixture()} now={NOW} />);
    const marker = screen.getByTestId('provenance-registrationDeadlineAt');
    expect(marker).toHaveTextContent('as stated by hackxyz-site, verified 2 h ago');

    // Keyboard-reachable, not hover-only (§16.3).
    expect(marker).toHaveAttribute('aria-expanded', 'false');
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getAllByRole('note').length).toBeGreaterThan(0);
  });

  it('opens on the keyboard and lists every source that stated the field', async () => {
    const user = userEvent.setup();
    render(<FactsGrid event={detailFixture()} now={NOW} />);
    const marker = screen.getByTestId('provenance-teamMax');
    marker.focus();
    await user.keyboard('{Enter}');
    const note = within(screen.getByRole('note'));
    expect(note.getByText(/hackxyz-site.*\(selected\)/)).toBeInTheDocument();
    expect(note.getAllByRole('listitem')).toHaveLength(3);
    expect(
      note.getByText('Selected because hackxyz-site is the most trusted source stating it'),
    ).toBeInTheDocument();
  });

  it('puts no provenance on a fact the app worked out itself', () => {
    render(<FactsGrid event={detailFixture()} now={NOW} />);
    // Distance is computed from the campus; nobody "stated" it.
    expect(screen.getByText('~202 km (straight line)')).toBeInTheDocument();
    expect(screen.queryByTestId('provenance-distanceKm')).not.toBeInTheDocument();
  });

  it('is accessible', async () => {
    render(<FactsGrid event={detailFixture()} now={NOW} />);
    await expect(document.body).toBeAccessible();
  });
});

describe('the deadlines timeline', () => {
  it('orders the deadlines and respects each one\u2019s precision', () => {
    render(<DeadlineTimeline deadlines={detailFixture().deadlines} now={NOW} />);
    const rows = within(screen.getByTestId('deadline-timeline')).getAllByRole('listitem');
    expect(rows.map((row) => row.textContent?.split(/\s{2,}/)[0])).toEqual([
      expect.stringContaining('Registration closes'),
      expect.stringContaining('Slide deck due'),
      expect.stringContaining('Final submission'),
    ]);
    // A stated time is shown; a day-only date is "by 7 Oct" (ADR-0015).
    expect(rows[0]).toHaveTextContent(/\d{2}:\d{2}/);
    expect(rows[1]).toHaveTextContent(/^.*by \d+ \w{3}/);
    expect(rows[1]).not.toHaveTextContent('00:00');
  });

  it('labels a deadline somebody added by hand', () => {
    render(<DeadlineTimeline deadlines={detailFixture().deadlines} now={NOW} />);
    const rows = within(screen.getByTestId('deadline-timeline')).getAllByRole('listitem');
    expect(rows[2]).toHaveTextContent('Added by hand');
    expect(rows[0]).not.toHaveTextContent('Added by hand');
  });

  it('renders nothing rather than an empty heading', () => {
    const { container } = render(<DeadlineTimeline deadlines={[]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('the change history', () => {
  const load = vi.fn();

  it('is newest first and renders causes as words', () => {
    render(
      <ChangeHistory
        items={detailFixture().history.items}
        now={NOW}
        hasOlder
        isLoadingOlder={false}
        onLoadOlder={load}
      />,
    );
    const rows = within(screen.getByTestId('change-history')).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Registration deadline');
    expect(rows[0]).toHaveTextContent('Found by a scrape');
    expect(rows[1]).toHaveTextContent('Merged with a duplicate');
    // No enum values on the screen.
    expect(screen.queryByText(/SCRAPE|MERGE|registrationDeadlineAt/)).not.toBeInTheDocument();
  });

  it('appends the older page rather than replacing the newer one', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <ChangeHistory
        items={detailFixture().history.items}
        now={NOW}
        hasOlder
        isLoadingOlder={false}
        onLoadOlder={load}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Load older' }));
    expect(load).toHaveBeenCalled();
    rerender(
      <ChangeHistory
        items={[...detailFixture().history.items, ...OLDER_HISTORY]}
        now={NOW}
        hasOlder={false}
        isLoadingOlder={false}
        onLoadOlder={load}
      />,
    );
    const rows = within(screen.getByTestId('change-history')).getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[2]).toHaveTextContent('Corrected by hand');
    expect(screen.queryByRole('button', { name: 'Load older' })).not.toBeInTheDocument();
  });

  it('says so plainly when nothing has changed', () => {
    render(
      <ChangeHistory
        items={[]}
        now={NOW}
        hasOlder={false}
        isLoadingOlder={false}
        onLoadOlder={load}
      />,
    );
    expect(screen.getByText(/Nothing has changed/)).toBeInTheDocument();
  });
});

describe('the category chips', () => {
  const chips = (canOverride: boolean, onSave = vi.fn()) => {
    render(
      <CategoryChips
        categories={detailFixture().categories}
        canOverride={canOverride}
        isSaving={false}
        onSave={onSave}
      />,
    );
    return onSave;
  };

  it('says where each category came from, as icon and words', () => {
    chips(true);
    const list = within(screen.getByTestId('category-chips'));
    expect(list.getByText('(from a rule)')).toBeInTheDocument();
    expect(list.getByText('(from the source’s tag)')).toBeInTheDocument();
    // A suppressed category is not carried; it is offered back instead.
    expect(list.queryByText('Robotics')).not.toBeInTheDocument();
  });

  it('sends the whole intended set when one is removed', async () => {
    const user = userEvent.setup();
    const onSave = chips(true);
    await user.click(screen.getByRole('button', { name: 'Remove AI/ML' }));
    const [[sent]] = onSave.mock.calls as [[string[]]];
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(detailFixture().categories[1]?.id);
  });

  it('adds a suppressed category back', async () => {
    const user = userEvent.setup();
    const onSave = chips(true);
    await user.click(screen.getByRole('button', { name: /Add back/ }));
    await user.click(screen.getByRole('button', { name: 'Robotics' }));
    const [[sent]] = onSave.mock.calls as [[string[]]];
    expect(sent).toHaveLength(3);
  });

  it('promises that a manual choice survives re-classification', () => {
    chips(true);
    expect(screen.getByText(/survive re-classification/)).toBeInTheDocument();
  });

  it('hides the controls — not the chips — without the permission (§10.1)', () => {
    chips(false);
    expect(screen.getByText('AI/ML')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove AI/ML' })).not.toBeInTheDocument();
    expect(screen.queryByText(/survive re-classification/)).not.toBeInTheDocument();
  });
});

describe('§13 opening safely', () => {
  it('accepts only http and https', () => {
    expect(isExternalUrl('https://hackxyz.example.edu/')).toBe(true);
    expect(isExternalUrl('http://hackxyz.example.edu/')).toBe(true);
    for (const url of [
      'file:///C:/Windows/System32/cmd.exe',
      'javascript:alert(1)',
      'ms-settings:',
      'not a url',
    ]) {
      expect(isExternalUrl(url), url).toBe(false);
    }
  });
});
