import { beforeEach, describe, expect, it, vi } from 'vitest';

import { isExternalUrl, openExternal } from './external.js';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));

/**
 * §13's "URLs open in the default browser", ruling R78.
 *
 * The refusal rules that matter live in `external.rs`, because that is the side
 * that can start a program. What is checked here is that the page hands the URL
 * to the shell rather than to `window.open` — the M1 fault where "Open
 * registration" did nothing in the packaged app — and that a refusal comes back
 * as `false` so the caller can offer the URL to copy.
 */

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe('opening an external link', () => {
  it('hands a web or email link to the shell, never to the WebView', async () => {
    for (const url of [
      'https://devfolio.co/hackathon/x',
      'http://ctftime.org/event/1',
      'mailto:professor@example.edu',
    ]) {
      await expect(openExternal(url)).resolves.toBe(true);
      expect(invoke).toHaveBeenCalledWith('open_external', { url });
    }
  });

  it('refuses anything that is not one of §13 three kinds, without an IPC call', async () => {
    for (const url of [
      'file:///C:/Windows/System32/calc.exe',
      'javascript:alert(1)',
      'ms-settings:windowsupdate',
      '\\\\server\\share\\payload.exe',
      'not a url',
      '',
    ]) {
      expect(isExternalUrl(url)).toBe(false);
      await expect(openExternal(url)).resolves.toBe(false);
    }
    expect(invoke).not.toHaveBeenCalled();
  });

  it('reports a shell refusal as false, so the caller can offer the URL to copy', async () => {
    invoke.mockRejectedValue(new Error('Junction opens web and email links only.'));
    await expect(openExternal('https://evil.test/x')).resolves.toBe(false);
  });
});
