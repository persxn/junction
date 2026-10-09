import { NAVIGATE_EVENT, type CriticalToast } from '@compintel/contracts';
import * as core from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import { isInternalRoute } from '../features/notifications/notification-model.js';

/**
 * The tray's notification surface (R90, R24, WP-23). The UI owns the count and
 * decides what is CRITICAL; the shell draws the badge and shows the toast. The
 * WebView stays alive while the window is closed to the tray, so this keeps
 * working with no window on screen. In a browser there is no shell, and each
 * call is a no-op.
 */

/** Never throws: a browser, or a test that mocks the module partly, is simply "no shell". */
function inTauri(): boolean {
  try {
    return core.isTauri();
  } catch {
    return false;
  }
}

export async function setTrayUnread(count: number): Promise<void> {
  if (!inTauri()) return;
  await core.invoke('tray_set_unread', { count });
}

export async function notifyCritical(toast: CriticalToast): Promise<void> {
  if (!inTauri()) return;
  await core.invoke('notify_critical', { toast });
}

/** A toast was clicked: go where it points — if it points inside the app. */
export function onToastNavigate(navigate: (route: string) => void): () => void {
  if (!inTauri()) return () => undefined;
  let stop: (() => void) | undefined;
  let cancelled = false;
  void listen<string>(NAVIGATE_EVENT, (event) => {
    if (isInternalRoute(event.payload)) navigate(event.payload);
  }).then((unlisten) => {
    if (cancelled) unlisten();
    else stop = unlisten;
  });
  return () => {
    cancelled = true;
    stop?.();
  };
}
