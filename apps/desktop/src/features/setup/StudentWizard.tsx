import type { BackendConnection } from '@compintel/contracts';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { completeSetup } from '../../api/setup.js';
import { isApiProblem, type ApiProblem } from '../../api/problem.js';
import { markJustSetUp } from '../../auth/first-run.js';
import { Field } from './Field.js';
import { PlacePicker } from './PlacePicker.js';
import {
  EMPTY_STUDENT_VALUES,
  hasErrors,
  nextStudentStep,
  previousStudentStep,
  STUDENT_STEP_DESCRIPTIONS,
  STUDENT_STEP_TITLES,
  STUDENT_STEPS,
  toStudentRequest,
  validateStudentStep,
  type Representing,
  type StudentErrors,
  type StudentStep,
  type StudentValues,
} from './student-wizard-state.js';
import { WizardFrame } from './WizardFrame.js';

/**
 * The student wizard (WP-34): "Myself" asks where you are, "An institution" asks
 * which one and where its campus is; both then ask for the contact address event
 * sites see. The last Next writes the install and the app opens as the guest.
 */

export interface StudentWizardProps {
  readonly connection: BackendConnection;
  readonly representing: Representing;
  /** Back from the first step returns to "Who is setting up Junction?". */
  readonly onBack: () => void;
  readonly onFinished: () => void;
}

export function StudentWizard({
  connection,
  representing,
  onBack,
  onFinished,
}: StudentWizardProps): React.JSX.Element {
  const steps = STUDENT_STEPS[representing];
  const [step, setStep] = useState<StudentStep>(steps[0] ?? 'contact');
  const [values, setValues] = useState<StudentValues>(EMPTY_STUDENT_VALUES);
  const [errors, setErrors] = useState<StudentErrors>({});
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const change = <K extends keyof StudentValues>(field: K, value: StudentValues[K]): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const submit = async (): Promise<void> => {
    setBusy(true);
    setProblem(undefined);
    try {
      await completeSetup(connection, toStudentRequest(representing, values));
      markJustSetUp();
      onFinished();
    } catch (cause) {
      setProblem(
        isApiProblem(cause)
          ? cause
          : ({ title: 'Setup could not be completed', detail: String(cause) } as ApiProblem),
      );
    } finally {
      setBusy(false);
    }
  };

  const advance = (): void => {
    const found = validateStudentStep(step, values);
    if (hasErrors(found)) {
      setErrors(found);
      return;
    }
    const following = nextStudentStep(representing, step);
    if (following === undefined) {
      void submit();
      return;
    }
    setErrors({});
    setStep(following);
  };

  const back = previousStudentStep(representing, step);
  const last = nextStudentStep(representing, step) === undefined;

  return (
    <WizardFrame
      step={step}
      rail={{ steps, titles: STUDENT_STEP_TITLES }}
      title={STUDENT_STEP_TITLES[step]}
      description={STUDENT_STEP_DESCRIPTIONS[step]}
      error={
        problem === undefined ? undefined : (
          <>
            <p className="font-medium">{problem.title}</p>
            {problem.detail !== undefined && <p className="text-sm">{problem.detail}</p>}
          </>
        )
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => {
              setErrors({});
              setProblem(undefined);
              if (back === undefined) onBack();
              else setStep(back);
            }}
            className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-medium hover:bg-surface-hover"
          >
            <ArrowLeft aria-hidden="true" className="size-4" />
            Back
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={advance}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {busy ? 'Setting up…' : last ? 'Start using Junction' : 'Next'}
            {!busy && <ArrowRight aria-hidden="true" className="size-4" />}
          </button>
        </>
      }
    >
      {step === 'about' && (
        <>
          <Field
            label="Your name (optional)"
            value={values.displayName}
            onChange={(value) => {
              change('displayName', value);
            }}
            hint="Shown in the app. Leave it empty to stay “Guest”."
            error={errors.displayName}
            autoComplete="name"
          />
          <PlacePicker
            connection={connection}
            label="Where are you?"
            value={values.place}
            error={errors.place}
            onChange={(value) => {
              change('place', value);
            }}
          />
        </>
      )}
      {step === 'institution' && (
        <>
          <Field
            label="Institution"
            value={values.organizationName}
            onChange={(value) => {
              change('organizationName', value);
            }}
            placeholder="Example Institute of Technology"
            error={errors.organizationName}
          />
          <Field
            label="Club, chapter or team"
            value={values.groupName}
            onChange={(value) => {
              change('groupName', value);
            }}
            placeholder="Coding Club"
            error={errors.groupName}
          />
        </>
      )}
      {step === 'campus' && (
        <PlacePicker
          connection={connection}
          label="Campus"
          value={
            values.place.label === ''
              ? { ...values.place, label: values.organizationName }
              : values.place
          }
          error={errors.place}
          preferInstitutions
          onChange={(value) => {
            change('place', value);
          }}
        />
      )}
      {step === 'contact' && (
        <Field
          label="Contact e-mail for event sites"
          type="email"
          value={values.contact}
          onChange={(value) => {
            change('contact', value);
          }}
          hint="Junction tells the sites it reads who to contact if it ever bothers them. It is not an account, and nothing is sent to it."
          error={errors.contact}
          autoComplete="email"
        />
      )}
    </WizardFrame>
  );
}
