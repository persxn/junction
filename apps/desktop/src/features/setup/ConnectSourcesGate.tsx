import { useAuth } from '../../auth/auth-context.js';
import { ConnectSourcesScreen } from './ConnectSourcesScreen.js';
import { useConnectPrompt } from './use-connect-prompt.js';

/**
 * The gate that shows "Connect your sources" once (R74's product flow).
 *
 * **Where it sits.** pre-M2a asked for it between the wizard and `SessionGate`.
 * It is one gate lower — above the router, below sign-in — because the step has
 * to store a session, and `PUT /admin/sources/:key/session` needs an
 * authenticated administrator (§10.2 `source.manage`). The wizard signs nobody
 * in: `SetupResult` carries a recovery code, not a token. A screen between the
 * wizard and the login screen could therefore show the sign-in buttons and then
 * fail every one of them with a 401, which is worse than asking a moment later.
 * What the prompt actually wanted — right after the wizard finishes, once, not
 * inside R40's transaction, never blocking sign-in — all holds here.
 *
 * An account without `source.manage` never sees it, so the step is not something
 * a professor can be stuck behind, and the flag it would close is not something
 * they can close for the administrator.
 *
 * Reopening it later is a route (`/admin/sources/connect`), not this gate: a gate
 * that swapped the router out would throw away whatever screen the professor was
 * on to show them a step they asked for from a link.
 */
export function ConnectSourcesGate({
  children,
}: {
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const { can } = useAuth();
  const enabled = can('source.manage');
  const prompt = useConnectPrompt(enabled);

  if (!enabled || prompt.isLoading || !prompt.pending) {
    return <>{children}</>;
  }
  return (
    <ConnectSourcesScreen
      sources={prompt.sources}
      onDone={prompt.finish}
      isSaving={prompt.isFinishing}
    />
  );
}
