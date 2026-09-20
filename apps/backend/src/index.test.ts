import { describe, expect, it } from 'vitest';

import { API_VERSION } from '@compintel/contracts';

import { describeBuild } from './index.js';

describe('describeBuild', () => {
  it('names the backend package', () => {
    expect(describeBuild().name).toBe('@compintel/backend');
  });

  it('reports the API version from @compintel/contracts', () => {
    expect(describeBuild().apiVersion).toBe(API_VERSION);
  });

  it('returns a fresh object each call', () => {
    expect(describeBuild()).not.toBe(describeBuild());
    expect(describeBuild()).toStrictEqual(describeBuild());
  });
});
