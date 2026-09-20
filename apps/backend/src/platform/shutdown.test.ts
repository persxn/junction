import { pino } from 'pino';
import { describe, expect, it } from 'vitest';

import { SHUTDOWN_PHASES, ShutdownRegistry } from './shutdown.js';

const silent = pino({ enabled: false });

describe('ShutdownRegistry', () => {
  it('starts empty', () => {
    const registry = new ShutdownRegistry();
    expect(registry.names()).toStrictEqual([]);
    for (const phase of SHUTDOWN_PHASES) {
      expect(registry.names(phase)).toStrictEqual([]);
    }
  });

  it('runs hooks in reverse registration order within a phase', async () => {
    const order: string[] = [];
    const registry = new ShutdownRegistry();
    registry.register('resources', 'database', () => {
      order.push('database');
    });
    registry.register('resources', 'scheduler', () => {
      order.push('scheduler');
    });
    registry.register('resources', 'llm', () => {
      order.push('llm');
    });

    expect(await registry.runPhase('resources', silent)).toBe(0);
    expect(order).toStrictEqual(['llm', 'scheduler', 'database']);
  });

  it('keeps the phases apart (R14)', async () => {
    const order: string[] = [];
    const registry = new ShutdownRegistry();
    registry.register('resources', 'database', () => {
      order.push('database');
    });
    registry.register('streams', 'sse', () => {
      order.push('sse');
    });

    await registry.runPhase('streams', silent);
    expect(order).toStrictEqual(['sse']);
    await registry.runPhase('resources', silent);
    expect(order).toStrictEqual(['sse', 'database']);
  });

  it('awaits asynchronous hooks', async () => {
    const order: string[] = [];
    const registry = new ShutdownRegistry();
    registry.register('resources', 'slow', async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push('slow');
    });
    registry.register('resources', 'fast', () => {
      order.push('fast');
    });

    await registry.runPhase('resources', silent);
    expect(order).toStrictEqual(['fast', 'slow']);
  });

  it('keeps going when a hook throws but reports the failure count', async () => {
    const order: string[] = [];
    const registry = new ShutdownRegistry();
    registry.register('resources', 'database', () => {
      order.push('database');
    });
    registry.register('resources', 'broken', () => {
      throw new Error('will not close');
    });

    expect(await registry.runPhase('resources', silent)).toBe(1);
    expect(order).toStrictEqual(['database']);
  });

  it('reports registered names oldest first, filtered by phase', () => {
    const registry = new ShutdownRegistry();
    registry.register('resources', 'a', () => undefined);
    registry.register('streams', 'b', () => undefined);
    registry.register('resources', 'c', () => undefined);
    expect(registry.names()).toStrictEqual(['a', 'b', 'c']);
    expect(registry.names('resources')).toStrictEqual(['a', 'c']);
    expect(registry.names('streams')).toStrictEqual(['b']);
  });

  it('does not re-run a phase that has no hooks', async () => {
    expect(await new ShutdownRegistry().runPhase('streams', silent)).toBe(0);
  });
});
