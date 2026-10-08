import type { AuditLog } from '../../platform/audit.js';
import type { DatabaseHandle } from '../../platform/db.js';
import type { Clock } from '../../platform/time.js';
import { TransferRepository } from './repository.js';
import { TransferService } from './service.js';

/** The ownership-transfer module (WP-21), wired once from `main.ts` and the test servers. */

export interface TransferModule {
  readonly service: TransferService;
}

export function createTransferModule(options: {
  readonly db: DatabaseHandle;
  readonly audit: AuditLog;
  readonly clock?: Clock;
}): TransferModule {
  return {
    service: new TransferService({
      repo: new TransferRepository(options.db),
      audit: options.audit,
      ...(options.clock === undefined ? {} : { clock: options.clock }),
    }),
  };
}
