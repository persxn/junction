import { once } from 'node:events';
import { Readable } from 'node:stream';

import { afterEach, describe, expect, it } from 'vitest';

import { startTestServer, testConfig, type TestServer } from '../testing/harness.js';
import { installLifecycle } from './lifecycle.js';
import type { LoggerHandle } from './logger.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** A LoggerHandle whose close() we can observe, over the server's own logger. */
function handleFor(test: TestServer): LoggerHandle & { closed: () => number } {
  let closed = 0;
  return {
    logger: test.app.server.log as LoggerHandle['logger'],
    currentFile: () => undefined,
    close: () => {
      closed += 1;
    },
    closed: () => closed,
  };
}

/**
 * An already-finished stdin, which is what a dead shell leaves behind.
 * `readableEnded` only flips once the 'end' event has actually been emitted, so
 * the helper waits for it - otherwise the test would not be testing the case.
 */
async function endedStdin(): Promise<NodeJS.ReadStream> {
  const stream = Readable.from([]);
  stream.resume();
  await once(stream, 'end');
  return stream as unknown as NodeJS.ReadStream;
}

function openStdin(): NodeJS.ReadStream {
  return new Readable({ read: () => undefined }) as unknown as NodeJS.ReadStream;
}

describe('installLifecycle shutdown order (R14)', () => {
  it('runs streams hooks, then closes the server, then resources hooks', async () => {
    server = await startTestServer();
    const order: string[] = [];
    server.app.shutdown.register('streams', 'sse', () => {
      order.push('streams');
    });
    server.app.shutdown.register('resources', 'database', () => {
      order.push('resources');
    });

    const codes: number[] = [];
    const lifecycle = installLifecycle({
      config: testConfig(),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: (code) => codes.push(code),
      attachSignals: false,
      stdin: openStdin(),
    });

    // The server closing is the boundary the two phases sit either side of.
    server.app.shutdown.register('streams', 'probe-before-close', () => {
      order.push(`server-listening=${server?.app.server.server.listening ? 'yes' : 'no'}`);
    });
    server.app.shutdown.register('resources', 'probe-after-close', () => {
      order.push(`server-listening=${server?.app.server.server.listening ? 'yes' : 'no'}`);
    });

    lifecycle.start('test');
    await lifecycle.whenSettled();

    expect(order).toStrictEqual([
      'server-listening=yes',
      'streams',
      'server-listening=no',
      'resources',
    ]);
    expect(codes).toStrictEqual([0]);
  });

  it('exits 1 when a shutdown hook fails', async () => {
    server = await startTestServer();
    server.app.shutdown.register('resources', 'broken', () => {
      throw new Error('the database would not close');
    });

    const codes: number[] = [];
    const lifecycle = installLifecycle({
      config: testConfig(),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: (code) => codes.push(code),
      attachSignals: false,
      stdin: openStdin(),
    });

    lifecycle.start('test');
    await lifecycle.whenSettled();
    expect(codes).toStrictEqual([1]);
  });

  it('exits 1 when a streams hook fails, even if everything else works', async () => {
    server = await startTestServer();
    server.app.shutdown.register('streams', 'broken-stream', () => {
      throw new Error('a response would not end');
    });

    const codes: number[] = [];
    const lifecycle = installLifecycle({
      config: testConfig(),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: (code) => codes.push(code),
      attachSignals: false,
      stdin: openStdin(),
    });

    lifecycle.start('test');
    await lifecycle.whenSettled();
    expect(codes).toStrictEqual([1]);
  });

  it('flushes the log exactly once, after the hooks', async () => {
    server = await startTestServer();
    const handle = handleFor(server);
    const lifecycle = installLifecycle({
      config: testConfig(),
      app: server.app,
      loggerHandle: handle,
      exit: () => undefined,
      attachSignals: false,
      stdin: openStdin(),
    });

    lifecycle.start('test');
    await lifecycle.whenSettled();
    expect(handle.closed()).toBe(1);
  });

  it('ignores a second trigger', async () => {
    server = await startTestServer();
    let runs = 0;
    server.app.shutdown.register('resources', 'counted', () => {
      runs += 1;
    });

    const codes: number[] = [];
    const lifecycle = installLifecycle({
      config: testConfig(),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: (code) => codes.push(code),
      attachSignals: false,
      stdin: openStdin(),
    });

    lifecycle.start('first');
    lifecycle.start('second');
    await lifecycle.whenSettled();

    expect(runs).toBe(1);
    expect(codes).toStrictEqual([0]);
    expect(lifecycle.isShuttingDown()).toBe(true);
  });
});

describe('stdin lifeline (A17)', () => {
  it('shuts down immediately when stdin has already ended before listen', async () => {
    server = await startTestServer();
    const codes: number[] = [];
    const lifecycle = installLifecycle({
      config: testConfig({ stdinLifeline: true }),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: (code) => codes.push(code),
      attachSignals: false,
      stdin: await endedStdin(),
    });

    expect(lifecycle.isShuttingDown()).toBe(true);
    await lifecycle.whenSettled();
    expect(codes).toStrictEqual([0]);
  });

  it('shuts down when stdin ends later', async () => {
    server = await startTestServer();
    const stdin = openStdin();
    const codes: number[] = [];
    const lifecycle = installLifecycle({
      config: testConfig({ stdinLifeline: true }),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: (code) => codes.push(code),
      attachSignals: false,
      stdin,
    });
    expect(lifecycle.isShuttingDown()).toBe(false);

    stdin.push(null);
    await new Promise((resolve) => setImmediate(resolve));
    await lifecycle.whenSettled();
    expect(codes).toStrictEqual([0]);
  });

  it('ignores an already-ended stdin without the flag', async () => {
    server = await startTestServer();
    const lifecycle = installLifecycle({
      config: testConfig({ stdinLifeline: false }),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: () => undefined,
      attachSignals: false,
      stdin: await endedStdin(),
    });
    expect(lifecycle.isShuttingDown()).toBe(false);
  });
});

describe('hard timeout', () => {
  it('exits 1 when the shutdown outlives its budget', async () => {
    server = await startTestServer();
    server.app.shutdown.register('resources', 'never-finishes', async () => {
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    });

    const codes: number[] = [];
    const lifecycle = installLifecycle({
      config: testConfig(),
      app: server.app,
      loggerHandle: handleFor(server),
      exit: (code) => codes.push(code),
      attachSignals: false,
      stdin: openStdin(),
      timeoutMs: 50,
    });

    lifecycle.start('test');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(codes[0]).toBe(1);
    await lifecycle.whenSettled();
  });
});
