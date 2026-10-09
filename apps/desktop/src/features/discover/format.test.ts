import { describe, expect, it } from 'vitest';

import { inlineReasons } from './format.js';

describe('inlineReasons (WP-24)', () => {
  it('states the two weightiest, ties in the server’s order', () => {
    const r = (text: string, weightApplied: number) => ({ text, weightApplied });
    expect(
      inlineReasons([r('open', 10), r('soon', 15), r('interest', 20), r('trusted', 15)]).map(
        (reason) => reason.text,
      ),
    ).toStrictEqual(['interest', 'soon']);
    expect(inlineReasons([r('only', 0)]).map((reason) => reason.text)).toStrictEqual(['only']);
  });
});
