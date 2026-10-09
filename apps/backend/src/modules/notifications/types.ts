import type { NotificationPreference, NotificationType, Thresholds } from '@compintel/contracts';

/**
 * The notification type registry (WP-23, R110–R111), in `settings.define`
 * style: every type's defaults — on or off, thresholds where they apply, and
 * whether its CRITICAL ones toast. A person's stored preference wins; with none
 * stored, the default applies. It is a `Record` over the enum, so a type added
 * without defaults does not compile, and a test checks it at run time too.
 */

export interface TypeDefaults {
  readonly enabled: boolean;
  /** Deadline types only; null for changes and notices. */
  readonly thresholds: Thresholds | null;
  readonly toast: boolean;
}

export const DEADLINE_THRESHOLDS: Thresholds = { days: [7, 3, 1], dueDay: true, overdue: true };

const deadline: TypeDefaults = { enabled: true, thresholds: DEADLINE_THRESHOLDS, toast: true };
const notice: TypeDefaults = { enabled: true, thresholds: null, toast: true };

export const TYPE_DEFAULTS: Readonly<Record<NotificationType, TypeDefaults>> = {
  REG_DEADLINE: deadline,
  SUBMISSION_DEADLINE: deadline,
  STAGE_DUE: deadline,
  TASK_DUE: deadline,
  OVERDUE: deadline,
  NEW_MATCH: notice,
  EVENT_CHANGED: notice,
  EVENT_CANCELLED: notice,
  SCRAPER_FAILING: notice,
  BACKUP_FAILED: notice,
  SOURCE_BLOCKED: notice,
  CREDENTIAL_EXPIRED: notice,
  SYSTEM: { enabled: true, thresholds: null, toast: false },
};

export interface StoredPreference {
  readonly type: NotificationType;
  readonly isEnabled: boolean;
  readonly thresholdsJson: string | null;
  readonly toastEnabled: boolean;
}

/** Stored row ?? registry default. */
export function effectivePreference(
  type: NotificationType,
  stored: StoredPreference | undefined,
): NotificationPreference {
  const defaults = TYPE_DEFAULTS[type];
  if (stored === undefined) {
    return {
      type,
      isEnabled: defaults.enabled,
      thresholds: defaults.thresholds,
      toastEnabled: defaults.toast,
      isDefault: true,
    };
  }
  return {
    type,
    isEnabled: stored.isEnabled,
    thresholds:
      defaults.thresholds === null
        ? null
        : stored.thresholdsJson === null
          ? defaults.thresholds
          : (JSON.parse(stored.thresholdsJson) as Thresholds),
    toastEnabled: stored.toastEnabled,
    isDefault: false,
  };
}
