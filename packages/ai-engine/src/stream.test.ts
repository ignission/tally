import { describe, expect, it } from 'vitest';

import { sdkMessageToAgentEvent } from './stream';

describe('sdkMessageToAgentEvent', () => {
  it('assistant text → thinking', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'text', text: 'UC を読みます' }],
      },
    } as never);
    expect(evt).toEqual([{ type: 'thinking', text: 'UC を読みます' }]);
  });

  it('assistant tool_use → tool_use', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', id: 'tool-1', name: 'create_node', input: { title: 'x' } }],
      },
    } as never);
    expect(evt).toEqual([
      { type: 'tool_use', id: 'tool-1', name: 'create_node', input: { title: 'x' } },
    ]);
  });

  it('user tool_result → tool_result', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'tool-1',
            content: [{ type: 'text', text: '{"ok":true}' }],
          },
        ],
      },
    } as never);
    expect(evt).toEqual([
      {
        type: 'tool_result',
        id: 'tool-1',
        ok: true,
        output: '{"ok":true}',
      },
    ]);
  });

  it('result message → done', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'result',
      subtype: 'success',
      result: '完了しました',
    } as never);
    expect(evt).toEqual([{ type: 'done', summary: '完了しました' }]);
  });

  it('対応しないメッセージは空配列', () => {
    expect(sdkMessageToAgentEvent({ type: 'system' } as never)).toEqual([]);
  });

  it('result error subtype → error:agent_failed', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'result',
      subtype: 'error_max_turns',
    } as never);
    expect(evt).toEqual([
      {
        type: 'error',
        code: 'agent_failed',
        message: 'agent ended: error_max_turns',
      },
    ]);
  });

  it('user tool_result で is_error: true なら ok: false', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            tool_use_id: 't-1',
            content: 'boom',
            is_error: true,
          },
        ],
      },
    } as never);
    expect(evt[0]?.type).toBe('tool_result');
    if (evt[0]?.type === 'tool_result') {
      expect(evt[0].ok).toBe(false);
      expect(evt[0].output).toBe('boom');
    }
  });

  it('user tool_result で content が string 直渡し', () => {
    const evt = sdkMessageToAgentEvent({
      type: 'user',
      message: {
        content: [{ type: 'tool_result', tool_use_id: 't-1', content: 'raw' }],
      },
    } as never);
    expect(evt[0]?.type).toBe('tool_result');
    if (evt[0]?.type === 'tool_result') {
      expect(evt[0].output).toBe('raw');
    }
  });
});
