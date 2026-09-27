import { useNavigate } from '@tanstack/react-router';

import { Skeleton } from '../../../components/Skeleton.js';
import { ConnectSourcesScreen } from '../../setup/ConnectSourcesScreen.js';
import { useConnectPrompt } from '../../setup/use-connect-prompt.js';

/**
 * The same step, reopened from Admin → Sources (R74: "reopenable").
 *
 * A route rather than a flag on the gate, so reopening it does not unmount the
 * router and lose the screen the professor was on. Closing it goes back to the
 * sources list; the one-time flag is already written by then, and pressing Close
 * does not write it again.
 */
export function ConnectSourcesPage(): React.JSX.Element {
  const navigate = useNavigate();
  const prompt = useConnectPrompt(true);

  if (prompt.isLoading) {
    return (
      <div className="p-6">
        <Skeleton lines={4} label="Loading the sources you can sign in to" />
      </div>
    );
  }
  return (
    <ConnectSourcesScreen
      sources={prompt.sources}
      isSaving={prompt.isFinishing}
      reopened={!prompt.pending}
      onDone={() => {
        // Reached before the step was ever finished — a professor who skipped it
        // and came straight here — it still counts as finishing it.
        if (prompt.pending) {
          prompt.finish();
        }
        void navigate({ to: '/admin/sources' });
      }}
    />
  );
}
