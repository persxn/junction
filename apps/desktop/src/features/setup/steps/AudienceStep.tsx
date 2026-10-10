import { Building2, GraduationCap, School, UserRound } from 'lucide-react';

import { Guide } from '../../../components/Guide.js';
import type { Representing } from '../student-wizard-state.js';

/**
 * "Who is setting up Junction?" (WP-34, owner decisions O-5…O-7).
 *
 * One screen for both questions, so a student reaches the app in four: a
 * professor or department continues to today's wizard, unchanged; a student
 * also says whether they represent themselves or an institution.
 */

export type Audience = 'DEPARTMENT' | 'STUDENT';

export interface AudienceStepProps {
  readonly audience: Audience | undefined;
  readonly representing: Representing | undefined;
  readonly onAudience: (audience: Audience) => void;
  readonly onRepresenting: (representing: Representing) => void;
}

interface Choice<T extends string> {
  readonly value: T;
  readonly title: string;
  readonly detail: string;
  readonly icon: typeof UserRound;
}

const AUDIENCES: readonly Choice<Audience>[] = [
  {
    value: 'DEPARTMENT',
    title: 'A professor or department',
    detail: 'Track your students, teams and competitions, with accounts and encrypted backups.',
    icon: School,
  },
  {
    value: 'STUDENT',
    title: 'A student',
    detail: 'Find events and run your own teams. No account needed — you can make one later.',
    icon: GraduationCap,
  },
];

const REPRESENTING: readonly Choice<Representing>[] = [
  {
    value: 'MYSELF',
    title: 'Myself',
    detail: 'This is my own computer. Distances are measured from where I live.',
    icon: UserRound,
  },
  {
    value: 'INSTITUTION',
    title: 'An institution',
    detail: 'A club, chapter or college team, maybe on a shared computer with several people.',
    icon: Building2,
  },
];

function Choices<T extends string>({
  legend,
  name,
  choices,
  value,
  onChange,
}: {
  readonly legend: string;
  readonly name: string;
  readonly choices: readonly Choice<T>[];
  readonly value: T | undefined;
  readonly onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-1 font-medium">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {choices.map((choice) => {
          const Icon = choice.icon;
          return (
            <label
              key={choice.value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-line bg-surface p-3 has-[:checked]:border-accent has-[:checked]:bg-accent-surface"
            >
              <input
                type="radio"
                name={name}
                checked={value === choice.value}
                onChange={() => {
                  onChange(choice.value);
                }}
                className="mt-1 size-4 shrink-0 accent-[var(--ci-color-accent)]"
              />
              <span className="flex flex-col gap-0.5">
                <span className="flex items-center gap-2 font-medium">
                  <Icon aria-hidden="true" className="size-4 text-fg-subtle" />
                  {choice.title}
                </span>
                <span className="text-sm text-fg-muted">{choice.detail}</span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function AudienceStep({
  audience,
  representing,
  onAudience,
  onRepresenting,
}: AudienceStepProps): React.JSX.Element {
  return (
    <>
      <Choices
        legend="Who is setting up Junction?"
        name="audience"
        choices={AUDIENCES}
        value={audience}
        onChange={onAudience}
      />
      {audience === 'STUDENT' && (
        <>
          <Choices
            legend="Who are you representing?"
            name="representing"
            choices={REPRESENTING}
            value={representing}
            onChange={onRepresenting}
          />
          <Guide id="setup-student-representing" title="Myself or an institution?">
            <p>
              <strong>Myself</strong> sets Junction up for one person: you start as a guest, and can
              turn that into your own profile with a password whenever you like. Everything you made
              as the guest stays yours.
            </p>
            <p>
              <strong>An institution</strong> suits a club’s shared computer. Anyone can use it as a
              guest; the first person to create a profile becomes the lead, who can add members and
              switch guest access off.
            </p>
          </Guide>
        </>
      )}
    </>
  );
}
