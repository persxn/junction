/**
 * A list's total in words (WP-22, R107): the one formatter a Dashboard tile and
 * the header of the list it opens share, so an approximate total reads the same
 * in both places — "1,234", or "about 1,234".
 */
const NUMBER = new Intl.NumberFormat('en-IN');

export function formatCount(total: number, approximate = false): string {
  return `${approximate ? 'about ' : ''}${NUMBER.format(total)}`;
}
