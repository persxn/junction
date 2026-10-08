import {
  TransferPreview,
  TransferResult,
  type BackendConnection,
  type TransferCommitRequest,
  type TransferRequest,
} from '@compintel/contracts';

import { apiRequest } from './client.js';

/** `/api/v1/admin/ownership-transfer/…` (WP-21, R105), parsed against the contract. */

export async function previewTransfer(
  connection: BackendConnection,
  body: TransferRequest,
): Promise<TransferPreview> {
  return TransferPreview.parse(
    await apiRequest(connection, '/api/v1/admin/ownership-transfer/preview', {
      method: 'POST',
      body,
    }),
  );
}

export async function commitTransfer(
  connection: BackendConnection,
  body: TransferCommitRequest,
): Promise<TransferResult> {
  return TransferResult.parse(
    await apiRequest(connection, '/api/v1/admin/ownership-transfer/commit', {
      method: 'POST',
      body,
    }),
  );
}
