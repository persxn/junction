# ADR-0011: Backups: SQLite backup API + age encryption with passphrase-protected recovery key

- **Status:** Accepted (spec v1.1.6, 2026-09-20) — amended twice
- **Date:** 2026-09-20
- **Source:** ARCHITECTURE.md §1 (D-13), §4.16, §14, §21 (R41, R42)

## Context
Daily automatic backups (keep 14), manual backup and restore, and configurable destinations. Backups leave the
machine (USB, OneDrive, shares) and contain student PII. They must run unattended.

## Decision
- Pipeline: SQLite online backup → `PRAGMA integrity_check` on the copy → gzip → **age** encryption
  (`age-encryption`/typage) → `compintel-<kind>-<yyyyMMdd-HHmm>.age` + JSON manifest → read-back
  verification → rotation (14 AUTO, 10 MANUAL, 5 PRE_MIGRATION/PRE_RESTORE).
- **Keys, generated at setup (R42):** an X25519 identity from `age-encryption` (the TypeScript
  implementation). `settings.backup.publicKey` holds the public key in the clear;
  `settings.backup.privateKeyEncrypted` holds the identity encrypted to a scrypt (passphrase)
  recipient — **work factor 18**, ≈256 MiB transient, age's default. Unattended daily backups use the
  public key only, so no secret needs to be resident. Backups can also be decrypted with the standard
  `age` CLI. Passphrase rules: ≥ 12 characters, typed twice, not equal to the admin password.
- **Recovery material (R41):** two separate secrets, deliberately not one. (1) A one-time **admin
  recovery code** — 32 random bytes, Crockford base32 in groups of 5, shown once, stored only as an
  Argon2id hash in `settings.auth.recoveryCodeHash` (consumed by ADR-0010/R45, WP-30). It recovers
  *account access*, not backups, and never appears in the recovery file. (2) The **backup passphrase**,
  which exists only at the moment it is typed — it is never stored — and which encrypts the age
  private key above. The recovery file is `compintel-recovery-<yyyyMMdd>.txt`: public key,
  passphrase-encrypted identity, schema version, and `age` CLI instructions. No plaintext key, no
  recovery code. The setup wizard cannot finish until the admin confirms, with an explicit checkbox
  per item, that both the code and the file are saved.
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

## Amendments (v1.1)
- Pre-migration copies are local and unencrypted by design (ADR-0005 amendment); this ADR covers AUTO/MANUAL backups only.
- Schedule time is the host machine's local time.

## Amendments (v1.1.6 — architect review of M0)
- Folded in R41 (recovery material) and R42 (backup keys) above; self-issued while the architect was
  away (docs/handoff/M0.md), now reviewed and accepted as written.
- Confirms the split between the admin recovery code (account access, ADR-0010) and the backup
  passphrase (data access, this ADR): they must stay two secrets, since a code that could also unlock
  backups would defeat the "never stored" property of the passphrase.
