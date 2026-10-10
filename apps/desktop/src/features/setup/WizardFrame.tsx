import { Check } from 'lucide-react';

import { Logo } from '../../components/Logo.js';
import { NUMBERED_STEPS, STEP_TITLES, stepIndex, type WizardStep } from './wizard-state.js';

/**
 * The frame every setup step sits in.
 *
 * It is shaped like an installer on purpose: one card, the stages listed down
 * the left with the finished ones ticked, and Back/Next pinned to the bottom so
 * they never move between steps. Nothing else is on screen — no rail, no top
 * bar, no way round it — which is the visible half of ruling R39.
 */

export interface WizardFrameProps {
  readonly step: WizardStep;
  readonly title: string;
  readonly description: string;
  readonly children: React.ReactNode;
  readonly footer: React.ReactNode;
  /** Shown above the buttons; the server's complaint, when there is one. */
  readonly error?: React.ReactNode;
}

export function WizardFrame({
  step,
  title,
  description,
  children,
  footer,
  error,
}: WizardFrameProps): React.JSX.Element {
  const current = stepIndex(step);
  const stage = NUMBERED_STEPS.indexOf(step);
  const progress =
    step === 'done' ? 1 : Math.max(0, stage) / Math.max(1, NUMBERED_STEPS.length - 1);

  return (
    <div className="flex h-full items-center justify-center overflow-auto bg-surface-sunken p-6">
      <section
        aria-label="Junction setup"
        className="flex max-h-full w-full max-w-4xl overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--ci-shadow-popover)]"
      >
        <nav
          aria-label="Setup steps"
          className="hidden w-60 shrink-0 flex-col gap-1 border-r border-line bg-surface-raised p-4 sm:flex"
        >
          <p className="flex items-center gap-2 px-2 pb-3 font-display text-md font-semibold">
            <Logo size={26} />
            Junction
          </p>
          <ol className="flex flex-col gap-0.5">
            {NUMBERED_STEPS.map((candidate, index) => {
              const position = stepIndex(candidate);
              const done = position < current;
              const active = candidate === step;
              return (
                <li key={candidate}>
                  <span
                    aria-current={active ? 'step' : undefined}
                    className={
                      'flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm ' +
                      (active
                        ? 'bg-accent-surface font-medium text-accent'
                        : done
                          ? 'text-fg-muted'
                          : 'text-fg-subtle')
                    }
                  >
                    <span
                      aria-hidden="true"
                      className={
                        'flex size-5 shrink-0 items-center justify-center rounded-full border text-xs ' +
                        (done
                          ? 'border-success bg-success text-on-accent'
                          : active
                            ? 'border-accent text-accent'
                            : 'border-line-strong')
                      }
                    >
                      {done ? <Check aria-hidden="true" className="size-3" /> : index + 1}
                    </span>
                    <span className="truncate">{STEP_TITLES[candidate]}</span>
                    {done && <span className="sr-only">(done)</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </nav>

        <div className="flex min-w-0 flex-1 flex-col">
          <div
            aria-hidden="true"
            className="h-1 shrink-0 bg-surface-sunken"
            data-testid="setup-progress"
          >
            <div
              className="h-full w-full origin-left bg-accent transition-transform duration-[var(--ci-motion-slow)] ease-(--ease-out-ui)"
              style={{ transform: `scaleX(${String(progress)})` }}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-8">
            <h1 className="font-display text-xl">{title}</h1>
            <p className="mt-1.5 text-fg-muted">{description}</p>
            {/* Keyed on the step so React remounts it: each step animates in
                rather than the previous one's values flashing in the new form. */}
            <div key={step} className="ci-step mt-6 flex flex-col gap-4">
              {children}
            </div>
          </div>

          {error !== undefined && (
            <div
              role="alert"
              className="mx-8 mb-2 rounded-md border-l-4 border-danger bg-danger-surface p-3 text-danger"
            >
              {error}
            </div>
          )}

          <div className="flex shrink-0 items-center justify-between gap-3 border-t border-line bg-surface-raised px-8 py-4">
            {footer}
          </div>
        </div>
      </section>
    </div>
  );
}
