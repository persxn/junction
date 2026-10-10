import { VISIBILITY_EVENT } from '@compintel/contracts';
import * as core from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

/**
 * The shell's "window went to the tray / came back" signal (WP-33, R68). A
 * hidden Tauri window is not reliably a hidden document to WebView2, so the
 * shell says so itself. In a browser or a test there is no shell: a no-op.
 */
function inTauri(): boolean {
  try {
    return core.isTauri();
  } catch {
    return false;
  }
}

export function onWindowVisibility(onChange: (visible: boolean) => void): () => void {
  if (!inTauri()) return () => undefined;
  let stop: (() => void) | undefined;
  let cancelled = false;
  void listen<boolean>(VISIBILITY_EVENT, (event) => {
    onChange(event.payload);
  }).then((unlisten) => {
    if (cancelled) unlisten();
    else stop = unlisten;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}
