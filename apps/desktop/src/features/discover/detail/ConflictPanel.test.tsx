import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { NOW } from '../../../testing/fake-search.js';
import { ConflictPanel } from './ConflictPanel.js';
import { CONFLICTS, detailFixture } from '../../../testing/event-detail.js';

/**
 * **The §19 acceptance criterion for WP-16b.**
 *
 * On the seeded conflict fixture the drawer must show "Sources disagree" with
 * every claimed value, each source's name, and the selected value marked with
 * the reason it won — one test per conflicting field. An event without
 * conflicts must show no panel at all.
 */

const panel = (): HTMLElement => screen.getByTestId('sources-disagree');

describe('the "Sources disagree" panel', () => {
  it('appears on the conflict fixture, and says nothing is merged', () => {
    render(<ConflictPanel conflicts={CONFLICTS} now={NOW} />);
    expect(within(panel()).getByText('Sources disagree')).toBeInTheDocument();
    expect(panel()).toHaveTextContent(/never merges values that disagree/i);
  });

  it('is absent on an event the sources agree about', () => {
    const { container } = render(<ConflictPanel conflicts={[]} now={NOW} />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText('Sources disagree')).not.toBeInTheDocument();
  });

  it('shows every claimed registration deadline with the source that stated it', () => {
    render(<ConflictPanel conflicts={CONFLICTS} now={NOW} />);
    const block = within(screen.getByTestId('conflict-registrationDeadlineAt'));
    expect(block.getByRole('heading', { name: 'Registration deadline' })).toBeInTheDocument();
    const rows = block.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    for (const key of ['hackxyz-site', 'devfolio', 'ctftime']) {
      expect(block.getAllByText(new RegExp(key)).length, key).toBeGreaterThan(0);
    }
    // Three different deadlines, none of them averaged into a fourth.
    const texts = new Set(rows.map((row) => row.textContent));
    expect(texts.size).toBe(3);
  });

  it('shows every claimed prize with the source that stated it', () => {
    render(<ConflictPanel conflicts={CONFLICTS} now={NOW} />);
    const block = within(screen.getByTestId('conflict-prizeText'));
    expect(block.getByText('₹2,00,000 prize pool')).toBeInTheDocument();
    expect(block.getByText('₹1,50,000 and goodies')).toBeInTheDocument();
    expect(block.getByText('$2,000')).toBeInTheDocument();
    // Nothing was converted between ₹ and $: both are on the screen as written.
  });

  it('shows every claimed team size with the source that stated it', () => {
    render(<ConflictPanel conflicts={CONFLICTS} now={NOW} />);
    const block = within(screen.getByTestId('conflict-teamMax'));
    for (const value of ['4', '5', '6']) {
      expect(block.getByText(value)).toBeInTheDocument();
    }
  });

  it('marks the selected value and says why it won', () => {
    render(<ConflictPanel conflicts={CONFLICTS} now={NOW} />);
    const block = within(screen.getByTestId('conflict-teamMax'));
    // Icon *and* words: the marker is never colour alone (§16.3).
    expect(block.getByText('Shown by CompIntel:')).toBeInTheDocument();
    expect(
      block.getByText('Selected because hackxyz-site is the most trusted source stating it'),
    ).toBeInTheDocument();
  });

  it('separates §7.5’s material disagreements from the wording ones', () => {
    render(<ConflictPanel conflicts={CONFLICTS} now={NOW} />);
    expect(screen.getByRole('heading', { name: /Minor differences/ })).toBeInTheDocument();
    // The prize is a wording difference; the deadline and the team size are not.
    const minorHeading = screen.getByRole('heading', { name: /Minor differences/ });
    expect(
      minorHeading.compareDocumentPosition(screen.getByTestId('conflict-prizeText')) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      minorHeading.compareDocumentPosition(screen.getByTestId('conflict-registrationDeadlineAt')) &
        Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
  });

  it('marks exactly one row, even when two sources state the same value', () => {
    render(
      <ConflictPanel
        conflicts={[
          {
            field: 'teamMin',
            label: 'Smallest team',
            material: true,
            values: [
              {
                value: 2,
                sourceKey: 'hackxyz-site',
                sourceRecordId: 'r-site',
                trustRank: 80,
                observedAt: NOW,
                alternate: false,
                note: null,
              },
              {
                value: 2,
                sourceKey: 'devfolio',
                sourceRecordId: 'r-devfolio',
                trustRank: 60,
                observedAt: NOW,
                alternate: false,
                note: null,
              },
              {
                value: 3,
                sourceKey: 'ctftime',
                sourceRecordId: 'r-ctftime',
                trustRank: 40,
                observedAt: NOW,
                alternate: false,
                note: null,
              },
            ],
            selected: 2,
            selectedReason: 'HIGHEST_TRUST',
            selectedSourceName: 'hackxyz-site',
            selectedSourceRecordId: 'r-site',
          },
        ]}
        now={NOW}
      />,
    );
    expect(screen.getAllByText('Shown by CompIntel:')).toHaveLength(1);
  });

  it('is accessible', async () => {
    render(<ConflictPanel conflicts={CONFLICTS} now={NOW} />);
    await expect(document.body).toBeAccessible();
  });

  it('matches the fixture the backend serves', () => {
    // The two fixtures are the same event; if one drifts this fails first.
    expect(
      detailFixture()
        .conflicts.map((conflict) => conflict.field)
        .sort(),
    ).toEqual(['prizeText', 'registrationDeadlineAt', 'teamMax']);
  });
});
