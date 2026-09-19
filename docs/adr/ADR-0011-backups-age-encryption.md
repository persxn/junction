# ADR-0011: Backups: SQLite backup API + age encryption with passphrase-protected recovery key

- **Status:** Proposed
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-13), §4.16, §14

## Context
Daily automatic backups (keep 14), manual backup and restore, and configurable destinations. Backups leave the
machine (USB, OneDrive, shares) and contain student PII. They must run unattended.

## Decision
- Pipeline: SQLite online backup → `PRAGMA integrity_check` on the copy → gzip → **age** encryption
  (`age-encryption`/typage) → `compintel-<kind>-<yyyyMMdd-HHmm>.age` + JSON manifest → read-back
  verification → rotation (14 AUTO, 10 MANUAL, 5 PRE_MIGRATION/PRE_RESTORE).
- Keys: an X25519 key pair is generated at setup. The **public key** is stored in settings, so unattended backups need no secret.
  The **private key** exists only passphrase-encrypted (in settings and in a forced recovery-file export).
  Backups can also be decrypted with the standard `age` CLI.
- Daily at a configurable time (default 13:00), catching up if missed. Pre-checks: writable destination and free space
  ≥ 3 × the last backup.
- Restore: validate → automatic PRE_RESTORE backup → stop scheduler → atomic swap → forward migrations →
  restart → audit. "Test restore" goes into a temporary DB.
- The DB at rest relies on BitLocker/Device Encryption, and the health page warns when it is absent.
- Not backed up: snapshots, logs, models, gazetteer.

## Consequences
- Lost passphrase + lost recovery file = unreadable backups. Mitigated by the forced recovery export and a
  monthly test-restore reminder.

## Alternatives considered
- A DPAPI-protected key: unattended, but machine-bound, so restoring on a new PC fails.
- No encryption: unacceptable once backups hold PII off-machine.
- SQLCipher: its key would sit on the same machine; adds little over BitLocker.
