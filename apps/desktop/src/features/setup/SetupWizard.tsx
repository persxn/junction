import type { BackendConnection, PathCheckResult, SetupResult } from '@compintel/contracts';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { useCallback, useState } from 'react';

import { checkBackupPath, completeSetup } from '../../api/setup.js';
import { isApiProblem, type ApiProblem } from '../../api/problem.js';
import { pickFolder, saveTextFile } from '../../shell/backend.js';
import {
  AdministratorStep,
  CampusStep,
  ContactStep,
  OrganizationStep,
} from './steps/BasicSteps.js';
import { FoldersStep } from './steps/FoldersStep.js';
import { DoneStep, PassphraseStep, RecoveryStep, WelcomeStep } from './steps/RecoverySteps.js';
import { WizardFrame } from './WizardFrame.js';
import {
  clearError,
  EMPTY_VALUES,
  nextStep,
  previousStep,
  STEP_TITLES,
  toSetupRequest,
  validateStep,
  type FieldErrors,
  type WizardField,
  type WizardStep,
  type WizardValues,
} from './wizard-state.js';

/**
 * The first-run wizard (rulings R39–R44).
 *
 * It owns the step, the values and the one call that writes them; the rules for
 * "may the user move on" live in `wizard-state.ts` and the screens in `steps/`.
 * There is no route to any of this and no way to leave it: the whole window is
 * the wizard until `POST /setup/complete` has succeeded, which is the UI half of
 * ruling R39 — the server half is that every other route answers 409.
 */

const DESCRIPTIONS: Readonly<Record<WizardStep, string>> = {
  welcome: 'A few questions, and then CompIntel is yours.',
  organization: 'Who this installation belongs to.',
  campus: 'Where your campus is, so “nearby” means something.',
  administrator: 'The first account. You can add more once you are in.',
  contact: 'How event sites can reach a person.',
  folders: 'Where CompIntel keeps its data, and where backups go.',
  passphrase: 'The secret that encrypts your backups.',
  recovery: 'Two things to keep somewhere safe. You will not see them again.',
  done: 'That is everything.',
};

export interface SetupWizardProps {
  readonly connection: BackendConnection;
  /** The shell's data directory, shown read-only on the Folders step (R43). */
  readonly dataDir: string | undefined;
  /** Called once the user leaves the last step; the app re-reads setup status. */
  readonly onFinished: () => void;
}

export function SetupWizard({
  connection,
  dataDir,
  onFinished,
}: SetupWizardProps): React.JSX.Element {
  const [step, setStep] = useState<WizardStep>('welcome');
  const [values, setValues] = useState<WizardValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [problem, setProblem] = useState<ApiProblem | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const [pathCheck, setPathCheck] = useState<PathCheckResult | undefined>(undefined);
  const [checkingPath, setCheckingPath] = useState(false);

  const [result, setResult] = useState<SetupResult | undefined>(undefined);
  const [savedTo, setSavedTo] = useState<string | undefined>(undefined);
  const [codeConfirmed, setCodeConfirmed] = useState(false);
  const [fileConfirmed, setFileConfirmed] = useState(false);

  const change = useCallback((field: WizardField, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    // The message goes as soon as the user starts fixing it; re-validating on
    // every keystroke would argue with them while they type.
    setErrors((current) => clearError(current, field));
  }, []);

  const choose = useCallback(async (): Promise<void> => {
    const picked = await pickFolder('Choose a folder for CompIntel backups');
    if (picked === undefined) {
      return;
    }
    setValues((current) => ({ ...current, backupDir: picked }));
    setErrors((current) => clearError(current, 'backupDir'));
    setCheckingPath(true);
    try {
      setPathCheck(await checkBackupPath(connection, picked));
    } catch (cause) {
      setPathCheck(undefined);
      setProblem(isApiProblem(cause) ? cause : undefined);
    } finally {
      setCheckingPath(false);
    }
  }, [connection]);

  const save = useCallback(async (): Promise<void> => {
    if (result === undefined) {
      return;
    }
    const folder = await pickFolder('Choose where to keep your recovery file');
    if (folder === undefined) {
      return;
    }
    try {
      setSavedTo(
        await saveTextFile({
          folder,
          fileName: result.recoveryFileName,
          contents: result.recoveryFile,
          // The wizard writes one file, once; replacing an earlier attempt in
          // the same folder is what the user means by saving again.
          overwrite: true,
        }),
      );
    } catch (cause) {
      setSavedTo(undefined);
      setProblem({
        title: 'The recovery file could not be saved',
        detail: cause instanceof Error ? cause.message : String(cause),
      } as ApiProblem);
    }
  }, [result]);

  /** The one call that writes the installation (R40). */
  const submit = useCallback(async (): Promise<void> => {
    setBusy(true);
    setProblem(undefined);
    try {
      setResult(await completeSetup(connection, toSetupRequest(values)));
      setStep('recovery');
    } catch (cause) {
      setProblem(
        isApiProblem(cause)
          ? cause
          : ({ title: 'Setup could not be completed', detail: String(cause) } as ApiProblem),
      );
    } finally {
      setBusy(false);
    }
  }, [connection, values]);

  const advance = useCallback((): void => {
    const found = validateStep(step, values);
    if (Object.values(found).some((message) => message !== undefined)) {
      setErrors(found);
      return;
    }
    if (step === 'folders' && pathCheck?.ok !== true) {
      setErrors({ backupDir: 'Choose a folder CompIntel can write to.' });
      return;
    }
    if (step === 'passphrase') {
      void submit();
      return;
    }
    if (step === 'done') {
      onFinished();
      return;
    }
    setErrors({});
    setProblem(undefined);
    const following = nextStep(step);
    if (following !== undefined) {
      setStep(following);
    }
  }, [step, values, pathCheck, submit, onFinished]);

  const back = previousStep(step);
  const canAdvance =
    step !== 'recovery' || (savedTo !== undefined && codeConfirmed && fileConfirmed);

  return (
    <WizardFrame
      step={step}
      title={STEP_TITLES[step]}
      description={DESCRIPTIONS[step]}
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
          <div>
            {back !== undefined && (
              <button
                type="button"
                onClick={() => {
                  setErrors({});
                  setProblem(undefined);
                  setStep(back);
                }}
                className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-medium hover:bg-surface-hover"
              >
                <ArrowLeft aria-hidden="true" className="size-4" />
                Back
              </button>
            )}
          </div>
          <button
            type="button"
            disabled={busy || !canAdvance}
            onClick={advance}
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 aria-hidden="true" className="size-4 animate-spin" />}
            {labelFor(step, busy)}
            {!busy && step !== 'done' && <ArrowRight aria-hidden="true" className="size-4" />}
          </button>
        </>
      }
    >
      {step === 'welcome' && <WelcomeStep />}
      {step === 'organization' && (
        <OrganizationStep values={values} errors={errors} onChange={change} />
      )}
      {step === 'campus' && <CampusStep values={values} errors={errors} onChange={change} />}
      {step === 'administrator' && (
        <AdministratorStep values={values} errors={errors} onChange={change} />
      )}
      {step === 'contact' && <ContactStep values={values} errors={errors} onChange={change} />}
      {step === 'folders' && (
        <FoldersStep
          values={values}
          errors={errors}
          onChange={change}
          dataDir={dataDir ?? 'Not reported by the shell'}
          checking={checkingPath}
          check={pathCheck}
          onPickFolder={() => {
            void choose();
          }}
        />
      )}
      {step === 'passphrase' && (
        <PassphraseStep values={values} errors={errors} onChange={change} />
      )}
      {step === 'recovery' && result !== undefined && (
        <RecoveryStep
          result={result}
          savedTo={savedTo}
          codeConfirmed={codeConfirmed}
          fileConfirmed={fileConfirmed}
          onSaveFile={() => {
            void save();
          }}
          onConfirmCode={setCodeConfirmed}
          onConfirmFile={setFileConfirmed}
        />
      )}
      {step === 'done' && (
        <DoneStep
          organizationName={values.organizationName.trim()}
          email={values.adminEmail.trim()}
        />
      )}
    </WizardFrame>
  );
}

function labelFor(step: WizardStep, busy: boolean): string {
  if (busy) {
    return 'Setting up…';
  }
  switch (step) {
    case 'welcome':
      return 'Get started';
    case 'passphrase':
      return 'Set up CompIntel';
    case 'recovery':
      return 'I have saved both';
    case 'done':
      return 'Sign in';
    default:
      return 'Next';
  }
}
