import type { SourceRow } from '../db/schema/index.js';
import { assessRequest, refusalErrorKind } from '../domain/scraping/gate.js';
import type { RunFailure } from './errors.js';
import type { SourceRequestContext } from './http/index.js';
import { representativeUrl } from './source-row.js';

/**
 * The gate, asked once about the source as a whole before a run is opened.
 *
 * It is the same `assessRequest` the client calls per request (§7.2's "the
 * client and the orchestrator both call this one function"), given the source's
 * own home URL. A source that is not approved, not enabled, or running on an
 * installation whose wizard has not finished is refused here and makes no
 * request at all.
 */
export function policyRefusal(
  setupComplete: boolean,
  source: SourceRow,
  context: SourceRequestContext,
): RunFailure | undefined {
  const decision = assessRequest({
    complianceStatus: context.complianceStatus,
    isEnabled: context.isEnabled,
    allowedPaths: context.allowedPaths,
    robots: 'UNKNOWN',
    url: representativeUrl(source),
    method: 'GET',
    setupComplete,
    requestsMade: 0,
    cap: context.maxRequestsPerRun,
  });
  if (decision.allowed) {
    return undefined;
  }
  return {
    kind: refusalErrorKind(decision.refusal),
    message: decision.reason,
    refusal: decision.refusal,
    pausesSource: false,
  };
}
