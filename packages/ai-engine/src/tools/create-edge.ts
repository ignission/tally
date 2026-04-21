import { EDGE_TYPES } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { AgentEvent } from '../stream';

import type { ToolResult } from './create-node';

export const CreateEdgeInputSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  type: z.enum(EDGE_TYPES),
});

export interface CreateEdgeDeps {
  store: ProjectStore;
  emit: (e: AgentEvent) => void;
}

export function createEdgeHandler(deps: CreateEdgeDeps) {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = CreateEdgeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    try {
      const edge = await deps.store.addEdge(parsed.data);
      deps.emit({ type: 'edge_created', edge });
      return { ok: true, output: JSON.stringify(edge) };
    } catch (err) {
      return { ok: false, output: `addEdge failed: ${String(err)}` };
    }
  };
}
