import { describe, expect, it } from 'vitest';

import { API_VERSION } from './version.js';
import * as contracts from './index.js';

describe('API_VERSION', () => {
  it('is a semver triple', () => {
    expect(API_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('is 1.0.0 for /api/v1', () => {
    expect(API_VERSION).toBe('1.0.0');
  });
});

describe('barrel', () => {
  it('re-exports the public surface', () => {
    expect(contracts.API_VERSION).toBe(API_VERSION);
    expect(contracts.EventType).toBeDefined();
    expect(contracts.EventMode).toBeDefined();
    expect(contracts.RegState).toBeDefined();
    expect(contracts.ComplianceStatus).toBeDefined();
    expect(contracts.ScrapeErrorKind).toBeDefined();
    expect(contracts.ErrorCode).toBeDefined();
    expect(contracts.ProblemDetails).toBeDefined();
    expect(contracts.ProblemFieldError).toBeDefined();
    expect(contracts.problemType).toBeDefined();
    expect(contracts.HealthResponse).toBeDefined();
    expect(contracts.ReadyLine).toBeDefined();
    expect(contracts.StartupErrorCode).toBeDefined();
    expect(contracts.HealthDatabase).toBeDefined();
    expect(contracts.Uuid7).toBeDefined();
    expect(contracts.uuid7Timestamp).toBeDefined();
  });
});
