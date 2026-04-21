import { describe, expect, it, vi } from 'vitest';

import { startAgent } from './ws';

describe('startAgent', () => {
  it('WS open → start を送信、受信イベントを AsyncIterable で流す', async () => {
    const sent: string[] = [];
    const listeners: Record<string, ((e: unknown) => void)[]> = {};

    class FakeSocket {
      readyState = 1;
      addEventListener(type: string, fn: (e: unknown) => void) {
        const list = listeners[type] ?? [];
        list.push(fn);
        listeners[type] = list;
      }
      removeEventListener() {}
      send(data: string) {
        sent.push(data);
      }
      close() {
        for (const fn of listeners.close ?? []) fn({});
      }
    }
    const fake = new FakeSocket();
    const wsCtor = vi.fn(() => fake);
    vi.stubGlobal('WebSocket', wsCtor);

    const h = startAgent({
      url: 'ws://test/agent',
      agent: 'decompose-to-stories',
      projectId: 'proj',
      input: { nodeId: 'uc-1' },
    });

    // open 発火
    for (const fn of listeners.open ?? []) fn({});
    expect(sent).toHaveLength(1);
    const first = sent[0];
    expect(first).toBeDefined();
    expect(JSON.parse(first as string).type).toBe('start');

    // message 発火 × 2
    const evt1 = { type: 'thinking', text: 'a' };
    for (const fn of listeners.message ?? []) fn({ data: JSON.stringify(evt1) });
    const evt2 = { type: 'done', summary: 'ok' };
    for (const fn of listeners.message ?? []) fn({ data: JSON.stringify(evt2) });
    // close 発火
    for (const fn of listeners.close ?? []) fn({});

    const received: unknown[] = [];
    for await (const e of h.events) received.push(e);
    expect(received).toEqual([evt1, evt2]);
  });
});
