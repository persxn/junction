import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { makeItem, NOW } from '../../testing/fake-search.js';
import { EventCard } from './EventCard.js';

const DAY = 86_400_000;
const noop = (): void => undefined;

function card(overrides: Parameters<typeof makeItem>[1]): HTMLElement {
  render(
    <EventCard
      item={makeItem(1, overrides)}
      now={NOW}
      selected
      cardRef={noop}
      onFocusCard={noop}
      onOpen={noop}
      onSave={noop}
      onHide={noop}
    />,
  );
  return screen.getByRole('article');
}

describe('the card says every status in words (§16.3)', () => {
  it.each([
    [0, 'Critical: Closes today'],
    [2, 'High urgency: Closes in 2 days'],
    [6, 'Medium urgency: Closes in 6 days'],
    [30, 'Open: Closes 22 Oct'],
  ])('%i days out → "%s", with an icon', (days, text) => {
    const article = card({
      registrationDeadlineAt: NOW + days * DAY,
      registrationDeadlinePrecision: 'DATETIME',
    });
    const status = within(article)
      .getByText(text.split(': ')[1] ?? '')
      .closest('p') as HTMLElement;
    expect(status).toHaveTextContent(text);
    expect(status.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
  });

  it('sources are named, the distance is D-06, and the conflict marker only shows on a conflict', () => {
    const article = card({
      sources: ['devfolio', 'ctftime'],
      distanceKm: 179.6,
      hasConflicts: true,
    });
    expect(within(article).getByRole('img', { name: 'Listed on Devfolio' })).toBeInTheDocument();
    expect(within(article).getByRole('img', { name: 'Listed on CTFtime' })).toBeInTheDocument();
    expect(within(article).getByText('~180 km (straight line)')).toBeInTheDocument();
    expect(within(article).getByTestId('conflict-marker')).toHaveTextContent('Sources disagree');
  });

  it('no conflict, no marker', () => {
    const article = card({ hasConflicts: false });
    expect(within(article).queryByTestId('conflict-marker')).toBeNull();
  });
});
