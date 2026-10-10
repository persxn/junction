import {
  armor,
  Decrypter,
  Encrypter,
  generateX25519Identity,
  identityToRecipient,
} from 'age-encryption';

/**
 * The backup key material (§14 "Keys", ADR-0011, ruling R42).
 *
 * One X25519 age identity is generated at setup and then split in two:
 *
 *   - the **recipient** (`age1...`) is stored in the clear, so the nightly
 *     backup job can encrypt without any secret on hand;
 *   - the **identity** (`AGE-SECRET-KEY-1...`) is stored only encrypted to a
 *     scrypt recipient derived from the passphrase the admin typed once.
 *
 * Losing both the passphrase and the exported recovery file makes every backup
 * unreadable. That is the deliberate trade in §14 — a key the machine could
 * decrypt by itself would also be a key an attacker with the machine could —
 * and it is why the wizard refuses to finish before the file is exported.
 *
 * Nothing here touches the database or the filesystem: this module makes and
 * unmakes key material, and the callers decide where it goes. WP-28's backup
 * pipeline reuses it unchanged.
 */

/**
 * scrypt work factor for the passphrase-wrapped identity.
 *
 * age's own default, and deliberately not higher: scrypt here uses r=8, so the
 * memory cost is 1 KiB x 2^logN — 256 MiB at 18 and 512 MiB at 19. The pilot
 * target in §5 is an 8 GB machine that also runs a model, and a restore is the
 * one moment the user is already anxious; half a gigabyte of transient
 * allocation is not worth one extra bit of work factor.
 */
export const SCRYPT_WORK_FACTOR = 18;

export interface BackupKeyPair {
  /** `age1...`, safe to store and to print in the recovery file. */
  readonly publicKey: string;
  /** The identity, armored and encrypted to the passphrase. */
  readonly privateKeyEncrypted: string;
}

/**
 * Generates the pair (R42). The plaintext identity exists only inside this call:
 * it is encrypted before returning, so no caller can accidentally persist it.
 */
export async function generateBackupKeys(
  passphrase: string,
  workFactor = SCRYPT_WORK_FACTOR,
): Promise<BackupKeyPair> {
  const identity = await generateX25519Identity();
  const publicKey = await identityToRecipient(identity);
  return { publicKey, privateKeyEncrypted: await wrapIdentity(identity, passphrase, workFactor) };
}

/** Encrypts an identity to a passphrase and armors it, so it is safe in a text file. */
export async function wrapIdentity(
  identity: string,
  passphrase: string,
  workFactor = SCRYPT_WORK_FACTOR,
): Promise<string> {
  const encrypter = new Encrypter();
  encrypter.setPassphrase(passphrase);
  encrypter.setScryptWorkFactor(workFactor);
  return armor.encode(await encrypter.encrypt(identity));
}

/**
 * The reverse, for a restore (WP-28) and for the test that proves the round
 * trip. A wrong passphrase throws; callers turn that into a message, never into
 * a hint about whether the file itself is valid.
 */
export async function unwrapIdentity(
  privateKeyEncrypted: string,
  passphrase: string,
): Promise<string> {
  const decrypter = new Decrypter();
  decrypter.addPassphrase(passphrase);
  return decrypter.decrypt(armor.decode(privateKeyEncrypted), 'text');
}

/** `junction-recovery-<yyyyMMdd>.txt` (R42). */
export function recoveryFileName(at: Date): string {
  const yyyy = at.getFullYear().toString().padStart(4, '0');
  const mm = (at.getMonth() + 1).toString().padStart(2, '0');
  const dd = at.getDate().toString().padStart(2, '0');
  return `junction-recovery-${yyyy}${mm}${dd}.txt`;
}

export interface RecoveryFileInput {
  readonly organizationName: string;
  readonly publicKey: string;
  readonly privateKeyEncrypted: string;
  readonly schemaVersion: number;
  readonly appVersion: string;
  readonly createdAt: Date;
}

/**
 * The text of the recovery file.
 *
 * Deliberately readable by a person with no Junction: it names the standard
 * `age` CLI and the two commands that get a database back, because the whole
 * point of an open format is that recovery does not depend on this application
 * still existing. It carries **no plaintext key and no admin recovery code** —
 * the code is a different secret for a different purpose (R41), and putting
 * both in one file would make one lost file lose everything.
 */
export function renderRecoveryFile(input: RecoveryFileInput): string {
  return [
    'Junction — backup recovery material',
    '====================================',
    '',
    `Institution : ${input.organizationName}`,
    `Created     : ${input.createdAt.toISOString()}`,
    `App version : ${input.appVersion}`,
    `Schema      : ${String(input.schemaVersion)}`,
    '',
    'KEEP THIS FILE. Without it — or without the backup passphrase you chose —',
    'your encrypted backups cannot be read by anyone, including us.',
    'Store it somewhere other than the machine Junction runs on.',
    '',
    'Public key (safe to share; backups are encrypted to it)',
    '-------------------------------------------------------',
    input.publicKey,
    '',
    'Private key, encrypted with your backup passphrase',
    '--------------------------------------------------',
    input.privateKeyEncrypted.trimEnd(),
    '',
    'How to restore without Junction',
    '--------------------------------',
    'Install age (https://age-encryption.org) and run, in a folder holding this',
    'file and a Junction backup:',
    '',
    '  1. Recover the private key (you will be asked for the passphrase):',
    '     age --decrypt -o junction-key.txt <the block above, saved on its own>',
    '',
    '  2. Decrypt a backup with it:',
    '     age --decrypt -i junction-key.txt -o backup.db.gz junction-AUTO-<date>.age',
    '',
    '  3. Un-gzip backup.db.gz. The result is a SQLite database.',
    '',
    'This file does not contain your Junction password or your admin recovery',
    'code. Those are separate, and are not recoverable from here.',
    '',
  ].join('\n');
}
