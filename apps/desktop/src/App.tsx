import { exitCompletely, hideToTray, openLogsFolder, retryBackend } from './shell/backend.js';
import { useBackend } from './shell/use-backend.js';
import './app.css';

/**
 * WP-05a/05b's whole UI: it shows that the shell supervises the backend, that
 * WebView2 can reach the loopback API, and it exposes the two shell preferences.
 * The real app shell, tokens and routing arrive with WP-06, so there is
 * deliberately no design system here.
 */
export function App(): React.JSX.Element {
  const {
    status,
    connection,
    health,
    transport,
    settings,
    error,
    refresh,
    toggleCloseToTray,
    toggleAutostart,
  } = useBackend();
  const failed = status?.phase === 'FAILED';
  const diagnostics = JSON.stringify({ status, health, transport, settings, error }, null, 2);

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
            <dt>API transport</dt>
            <dd>{transport === 'FETCH' ? 'fetch (direct loopback)' : 'shell proxy (fallback)'}</dd>
            <dt>Recent crashes</dt>
            <dd>{status?.recentCrashes ?? 0}</dd>
          </dl>
          {error !== undefined && <p className="error">{error}</p>}
        </section>
      )}

      <section className="panel">
        <h2>Shell</h2>
        <label>
          <input
            type="checkbox"
            checked={settings?.closeToTray ?? true}
            disabled={settings === undefined}
            onChange={toggleCloseToTray}
          />
          Close to tray (keep scraping when the window is closed)
        </label>
        <label>
          <input
            type="checkbox"
            checked={settings?.autostart ?? false}
            disabled={settings === undefined}
            onChange={toggleAutostart}
          />
          Start with Windows
        </label>
      </section>

      <div className="row">
        <button
          type="button"
          onClick={() => {
            void hideToTray();
          }}
        >
          Hide to tray
        </button>
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
