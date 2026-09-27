import { LoopbackRequest, type LoopbackResponse } from '@compintel/contracts';
import { type Mock } from 'vitest';

/**
 * The shell's `backend_request` proxy, in a test (ruling R78, finding F9).
 *
 * On a machine where WebView2 enforces Local Network Access the page cannot
 * reach `127.0.0.1` at all, and every request — Save, Hide, a category override,
 * POST search, every M2 form — goes through the shell instead. The Rust side is
 * tested in `loopback.rs`; what this covers is the other half: that the screens
 * work when it is the only transport they have.
 *
 * It answers by handing the request to whatever `fetch` stub the suite installed,
 * so a screen sees exactly the same backend either way and the only thing that
 * changed is the road there. The request is parsed with the real contract first,
 * so a malformed proxy call fails here rather than being quietly answered —
 * except for the body, which `LoopbackRequest` types as optional while
 * `backendRequest` sends `null` for a request without one (Rust reads
 * `Option<String>`, which is `null` over IPC). Nothing parses that schema at
 * runtime in the app, so the two have never disagreed out loud; here they would,
 * so the body is read as nullable.
 */
export function installShellProxy(invoke: Mock): void {
  invoke.mockImplementation(async (command: string, args?: unknown): Promise<unknown> => {
    if (command !== 'backend_request') {
      return undefined;
    }
    const sent = (args as { request?: Record<string, unknown> }).request ?? {};
    const request = LoopbackRequest.parse({
      ...sent,
      ...(sent.body === null ? { body: undefined } : {}),
    });
    const response = await fetch(`http://127.0.0.1:52991${request.path}`, {
      method: request.method,
      headers: { ...request.headers },
      ...(request.body === undefined || request.body === null ? {} : { body: request.body }),
    });
    const answer: LoopbackResponse = {
      status: response.status,
      // The suites' `fetch` stubs answer with the two fields the client reads and
      // no `Headers`; the real proxy always has them, and `Content-Type` is what
      // the client uses to tell a problem document from a body.
      headers:
        typeof response.headers?.entries === 'function'
          ? [...response.headers.entries()]
          : [['content-type', 'application/json']],
      body: await response.text(),
    };
    return answer;
  });
}
