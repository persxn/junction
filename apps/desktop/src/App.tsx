import { exitCompletely, openLogsFolder, retryBackend } from './shell/backend.js';
import { useBackend } from './shell/use-backend.js';
import './app.css';

/**
 * WP-05a's whole UI: it exists to show that the shell supervises the backend and
 * that WebView2 can reach the loopback API. The real app shell, tokens and
 * routing arrive with WP-06, so there is deliberately no design system here.
 */
export function App(): React.JSX.Element {
  const { status, connection, health, error, refresh } = useBackend();
  const failed = status?.phase === 'FAILED';

  const diagnostics = JSON.stringify({ status, health, error }, null, 2);

  return (
    <main>
      <h1>CompIntel</h1>

      {failed ? (
        <section className="panel panel-error">
          <h2>The background service stopped</h2>
          <p>{status.lastError ?? 'It crashed too often to keep restarting it.'}</p>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                void openLogsFolder();
              }}
            >
              Open logs
            </button>
            <button
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(diagnostics);
              }}
            >
              Copy diagnostics
            </button>
            <button
              type="button"
              onClick={() => {
                void retryBackend().then(refresh);
              }}
            >
              Retry
            </button>
          </div>
        </section>
      ) : (
        <section className="panel">
          <dl>
            <dt>Phase</dt>
            <dd>{status?.phase ?? 'connecting…'}</dd>
            <dt>Spawn generation</dt>
            <dd>{status?.generation ?? 0}</dd>
            <dt>Base URL</dt>
            <dd>{connection?.baseUrl ?? '—'}</dd>
            <dt>Backend health</dt>
            <dd>
              {health === undefined
                ? '—'
                : `${health.status} · v${health.appVersion} · api ${health.apiVersion} · db ${
                    health.database.ok ? 'ok' : 'down'
                  }`}
            </dd>
            <dt>Recent crashes</dt>
            <dd>{status?.recentCrashes ?? 0}</dd>
          </dl>
          {error !== undefined && <p className="error">{error}</p>}
        </section>
      )}

      <div className="row">
        <button
          type="button"
          onClick={() => {
            void exitCompletely();
          }}
        >
          Exit completely
        </button>
      </div>
    </main>
  );
}
