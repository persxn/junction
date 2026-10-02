import {
  PROGRAM_LABELS,
  STUDENT_STATUS_LABELS,
  proficiencyLabel,
  type Proficiency,
  type StudentProgram,
  type StudentStatus,
} from '@compintel/contracts';
import { CircleCheck, CirclePause, GraduationCap, type LucideIcon } from 'lucide-react';

/**
 * Words for every student enum (§16.3: a status is icon + label, never colour
 * alone; the UI sweep fails a raw enum value on screen).
 */

const STATUS_ICONS: Readonly<Record<StudentStatus, LucideIcon>> = {
  ACTIVE: CircleCheck,
  INACTIVE: CirclePause,
  ALUMNI: GraduationCap,
};

const STATUS_TONES: Readonly<Record<StudentStatus, string>> = {
  ACTIVE: 'text-success',
  INACTIVE: 'text-fg-subtle',
  ALUMNI: 'text-info',
};

export function StatusBadge({ status }: { readonly status: StudentStatus }): React.JSX.Element {
  const Icon = STATUS_ICONS[status];
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap">
      <Icon aria-hidden="true" className={`size-4 ${STATUS_TONES[status]}`} />
      {STUDENT_STATUS_LABELS[status]}
    </span>
  );
}

export const programLabel = (program: StudentProgram): string => PROGRAM_LABELS[program];

/** "Python · Advanced", "Hackathons" (an interest has no level). */
export function tagText(name: string, proficiency: Proficiency | null, relation: string): string {
  return relation === 'SKILL' ? `${name} · ${proficiencyLabel(proficiency)}` : name;
}

/** "27 Sep 2026" in the display zone. */
export function dayText(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
    .format(new Date(iso))
    .replace('Sept', 'Sep');
}
