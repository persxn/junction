import { useEffect, useState } from 'react';

import { previewAssign } from '../../../api/competitions.js';
import { isApiProblem } from '../../../api/problem.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { previewRequestOf, type StepProps } from './assign-model.js';

/**
 * Asks the server what the assignment would do (R98) once per who-is-taking-
 * part, and keeps the answer on the draft: the template step reads the event's
 * type from it, the review step the dates and conflicts. Returns a failure's
 * words, if any.
 */
export function useAssignPreview(
  draft: StepProps['draft'],
  onChange: StepProps['onChange'],
): string | undefined {
  const connection = useBackendConnection();
  const [error, setError] = useState<string | undefined>(undefined);
  const request = previewRequestOf(draft);
  const key = JSON.stringify(request);

  useEffect(() => {
    if (request === undefined || draft.preview !== undefined) return;
    let live = true;
    previewAssign(connection, request).then(
      (preview) => {
        if (live) onChange({ preview });
      },
      (cause: unknown) => {
        if (live) setError(isApiProblem(cause) ? (cause.detail ?? cause.title) : String(cause));
      },
    );
    return () => {
      live = false;
    };
    // `key` stands for the request; the draft object changes on every keystroke elsewhere.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, draft.preview === undefined]);

  return error;
}
