import type { StreamEvent } from '@compintel/contracts';
import { describe, expect, it } from 'vitest';

import {
  formatSseEvent,
  HEARTBEAT_INTERVAL_MS,
  parseLastEventId,
  REPLAY_MAX_AGE_MS,
  REPLAY_MAX_EVENTS,
  SSE_HEARTBEAT,
  StreamHub,
} from './stream.js';

/** The hub half of ruling R36; the route is covered in `routes/auth.test.ts`. */

function collector(): {
  events: StreamEvent[];
  closed: boolean;
  subscriber: Parameters<StreamHub['subscribe']>[0];
} {
  const state = { events: [] as StreamEvent[], closed: false };
  return {
    get events(): StreamEvent[] {
      return state.events;
    },
    get closed(): boolean {
      return state.closed;
    },
    subscriber: {
      send: (event) => state.events.push(event),
      close: () => {
        state.closed = true;
      },
    },
  };
}

describe('event ids', () => {
  it('start at 1 and increase by one', () => {
    const hub = new StreamHub();
    expect(hub.publish('stream.ready').id).toBe(1);
    expect(hub.publish('data.invalidated').id).toBe(2);
    expect(hub.publish('data.invalidated').id).toBe(3);
    expect(hub.lastEventId).toBe(3);
  });

  it('are monotonic across many publishes', () => {
    const hub = new StreamHub();
    const ids = Array.from({ length: 500 }, () => hub.publish('data.invalidated').id);
    expect(ids).toStrictEqual([...ids].sort((a, b) => a - b));
    expect(new Set(ids).size).toBe(500);
  });
});

describe('subscribers', () => {
  it('receives everything published after subscribing', () => {
    const hub = new StreamHub();
    hub.publish('data.invalidated', { domain: 'before' });
    const sink = collector();
    hub.subscribe(sink.subscriber);

    hub.publish('data.invalidated', { domain: 'events' });
    expect(sink.events.map((event) => event.payload.domain)).toStrictEqual(['events']);
  });

  it('stops receiving after unsubscribing', () => {
    const hub = new StreamHub();
    const sink = collector();
    const stop = hub.subscribe(sink.subscriber);
    hub.publish('data.invalidated');
    stop();
    hub.publish('data.invalidated');
    expect(sink.events).toHaveLength(1);
    expect(hub.subscriberCount).toBe(0);
  });

  it('reaches every open subscriber', () => {
    const hub = new StreamHub();
    const sinks = [collector(), collector(), collector()];
    for (const sink of sinks) {
      hub.subscribe(sink.subscriber);
    }
    hub.publish('notification.created', { id: 'n1' });
    for (const sink of sinks) {
      expect(sink.events).toHaveLength(1);
    }
  });
});

describe('Last-Event-ID replay (ruling R36)', () => {
  it('returns everything after the given id', () => {
    const hub = new StreamHub();
    for (let index = 0; index < 5; index += 1) {
      hub.publish('data.invalidated', { index });
    }
    expect(hub.replay(2).map((event) => event.id)).toStrictEqual([3, 4, 5]);
  });

  it('returns nothing for a client that is already current', () => {
    const hub = new StreamHub();
    hub.publish('data.invalidated');
    expect(hub.replay(1)).toStrictEqual([]);
  });

  it('returns nothing when no id was sent', () => {
    const hub = new StreamHub();
    hub.publish('data.invalidated');
    expect(hub.replay(undefined)).toStrictEqual([]);
    expect(hub.replay(0)).toStrictEqual([]);
  });

  it('keeps at most 200 events', () => {
    const hub = new StreamHub();
    for (let index = 0; index < REPLAY_MAX_EVENTS + 50; index += 1) {
      hub.publish('data.invalidated');
    }
    // 250 published, 200 kept: ids 51..250. Resuming from 50 is the oldest
    // position that can still be caught up.
    expect(hub.replay(50)).toHaveLength(REPLAY_MAX_EVENTS);
    expect(hub.replayGap(49)).toBe(true);
  });

  it('drops events older than five minutes', () => {
    let now = 1_000_000;
    const hub = new StreamHub({ now: () => now });
    hub.publish('data.invalidated');
    hub.publish('data.invalidated');
    now += REPLAY_MAX_AGE_MS + 1;
    hub.publish('data.invalidated');
    // The first two aged out, so only a client already at 2 can be caught up.
    expect(hub.replay(2).map((event) => event.id)).toStrictEqual([3]);
    expect(hub.replayGap(1)).toBe(true);
  });

  it('reports a gap rather than inventing history', () => {
    let now = 1_000_000;
    const hub = new StreamHub({ now: () => now, maxEvents: 3 });
    for (let index = 0; index < 10; index += 1) {
      hub.publish('data.invalidated');
    }
    // The buffer now starts at id 8; a client resuming from 2 cannot be caught up.
    expect(hub.replayGap(2)).toBe(true);
    expect(hub.replay(2)).toStrictEqual([]);
    // One that is still inside the buffer can be.
    expect(hub.replayGap(8)).toBe(false);
    expect(hub.replay(8).map((event) => event.id)).toStrictEqual([9, 10]);
    now += 1;
  });

  it('is not a gap when there is nothing to catch up on', () => {
    const hub = new StreamHub();
    expect(hub.replayGap(undefined)).toBe(false);
    expect(hub.replayGap(0)).toBe(false);
  });
});

describe('closing (rulings R14 and R36)', () => {
  it('closes every open subscriber', () => {
    const hub = new StreamHub();
    const sink = collector();
    hub.subscribe(sink.subscriber);
    hub.closeAll();
    expect(sink.closed).toBe(true);
    expect(hub.subscriberCount).toBe(0);
    expect(hub.isClosed).toBe(true);
  });

  it('closes a subscriber that arrives after shutdown started', () => {
    const hub = new StreamHub();
    hub.closeAll();
    const sink = collector();
    hub.subscribe(sink.subscriber);
    expect(sink.closed).toBe(true);
    expect(hub.subscriberCount).toBe(0);
  });
});

describe('the wire format', () => {
  it('writes id, event and data lines followed by a blank line', () => {
    const event: StreamEvent = { id: 7, type: 'data.invalidated', payload: { domain: 'events' } };
    expect(formatSseEvent(event)).toBe(
      'id: 7\nevent: data.invalidated\ndata: {"id":7,"type":"data.invalidated","payload":{"domain":"events"}}\n\n',
    );
  });

  it('sends the heartbeat as a comment every 15 seconds', () => {
    expect(SSE_HEARTBEAT.startsWith(':')).toBe(true);
    expect(SSE_HEARTBEAT.endsWith('\n\n')).toBe(true);
    expect(HEARTBEAT_INTERVAL_MS).toBe(15_000);
  });
});

describe('parseLastEventId', () => {
  it('reads a positive integer', () => {
    expect(parseLastEventId('12')).toBe(12);
    expect(parseLastEventId(['12', '13'])).toBe(12);
  });

  it('ignores anything else', () => {
    for (const header of [undefined, '', 'abc', '-1', '0', 'NaN']) {
      expect(parseLastEventId(header)).toBeUndefined();
    }
  });
});
