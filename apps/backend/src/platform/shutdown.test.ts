import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { ShutdownRegistry } from './shutdown.js';

const silent = pino({ enabled: false });

describe('ShutdownRegistry', () => {
  it('starts empty, as WP-04a leaves it', () => {
    expect(new ShutdownRegistry().names).toStrictEqual([]);
  });

  it('runs hooks in reverse registration order', async () => {
    const order: string[] = [];
    const registry = new ShutdownRegistry();
    registry.register('database', () => {
      order.push('database');
    });
    registry.register('scheduler', () => {
      order.push('scheduler');
    });
    registry.register('llm', () => {
      order.push('llm');
    });

    await registry.runAll(silent);
    expect(order).toStrictEqual(['llm', 'scheduler', 'database']);
  });

  it('awaits asynchronous hooks', async () => {
    const order: string[] = [];
    const registry = new ShutdownRegistry();
    registry.register('slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('slow');
    });
    registry.register('fast', () => {
      order.push('fast');
    });

    await registry.runAll(silent);
    expect(order).toStrictEqual(['fast', 'slow']);
  });

  it('keeps going when a hook throws', async () => {
    const order: string[] = [];
    const registry = new ShutdownRegistry();
    registry.register('database', () => {
      order.push('database');
    });
    registry.register('broken', () => {
      throw new Error('will not close');
    });

    await expect(registry.runAll(silent)).resolves.toBeUndefined();
    expect(order).toStrictEqual(['database']);
  });

  it('reports registered names oldest first', () => {
    const registry = new ShutdownRegistry();
    registry.register('a', () => undefined);
    registry.register('b', () => undefined);
    expect(registry.names).toStrictEqual(['a', 'b']);
  });
});
