import {
  OPEN_REFUSAL_TEXT,
  type CheckedStatus,
  type Resource,
  type StatPathsResult,
} from '@compintel/contracts';

import { relativeTime } from '../../lib/time.js';

/**
 * What a resource row says and offers (§16.2, rulings R102–R103, WP-20b) —
 * pure, so the rules are tested without a shell. A link opens in the browser
 * and is never checked. A path is the shell's business on the PC that added
 * it: elsewhere it says where it lives and offers Copy; outside the shell it
 * offers Copy only.
 */

export type PathStat = StatPathsResult['results'][number];

export interface RowState {
  /** The status line, or nothing (an unchecked link, a path that is fine). */
  readonly line: string | undefined;
  /** Shown as a warning (missing, unreachable) rather than as information. */
  readonly warn: boolean;
  readonly canOpen: boolean;
  readonly canReveal: boolean;
  /** Why Open is not offered, for its tooltip. */
  readonly openHint: string | undefined;
}

export const WEB_BUILD_TEXT =
  'Opening files needs the CompIntel desktop app — copy the path instead.';

export function isLink(resource: Resource): boolean {
  return resource.kind !== 'LOCAL_PATH';
}

/** Whether this PC may check the path: added here, or added without a PC name. */
export function sameMachine(resource: Resource, thisPc: string | undefined): boolean {
  return (
    thisPc !== undefined &&
    (resource.machineLabel === null || resource.machineLabel.toLowerCase() === thisPc.toLowerCase())
  );
}

function checkedLine(status: CheckedStatus, at: string | null, now: Date): string | undefined {
  const ago = at === null ? '' : ` — checked ${relativeTime(new Date(at), now)}`;
  if (status === 'MISSING') return `Not found on this PC${ago}`;
  if (status === 'UNREACHABLE') return 'Network location didn’t answer';
  return undefined;
}

export function rowState(input: {
  readonly resource: Resource;
  readonly shell: boolean;
  readonly thisPc: string | undefined;
  /** This session's check of the path, when the shell has answered. */
  readonly stat: PathStat | undefined;
  readonly now: Date;
}): RowState {
  const { resource, shell, thisPc, stat, now } = input;
  if (isLink(resource)) {
    return { line: undefined, warn: false, canOpen: true, canReveal: false, openHint: undefined };
  }
  if (!shell) {
    return {
      line: WEB_BUILD_TEXT,
      warn: false,
      canOpen: false,
      canReveal: false,
      openHint: WEB_BUILD_TEXT,
    };
  }
  if (!sameMachine(resource, thisPc)) {
    const where = `On ${resource.machineLabel ?? 'another PC'} — can’t check from here`;
    return { line: where, warn: false, canOpen: false, canReveal: false, openHint: where };
  }
  if (stat === undefined) {
    // Not checked yet this session: say what the last check found.
    const status = resource.checkStatus;
    const line =
      status === 'UNCHECKED' || status === 'OK'
        ? undefined
        : checkedLine(status, resource.lastCheckedAt, now);
    return {
      line,
      warn: line !== undefined,
      canOpen: false,
      canReveal: false,
      openHint: 'Checking…',
    };
  }
  if (stat.status !== 'OK') {
    // A path the shell refused to look up says why, not "not found".
    const refused =
      stat.reason !== null && stat.reason !== 'NOT_FOUND'
        ? OPEN_REFUSAL_TEXT[stat.reason]
        : undefined;
    const line = refused ?? checkedLine(stat.status, now.toISOString(), now);
    return { line, warn: true, canOpen: false, canReveal: false, openHint: line };
  }
  const refusal = stat.reason === null ? undefined : OPEN_REFUSAL_TEXT[stat.reason];
  return {
    line: stat.openable ? undefined : refusal,
    warn: false,
    canOpen: stat.openable,
    canReveal: true,
    openHint: refusal,
  };
}
