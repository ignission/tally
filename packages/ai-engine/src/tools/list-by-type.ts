import { NODE_TYPES } from '@tally/core';
import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { ToolResult } from './create-node';

export const ListByTypeInputSchema = z.object({ type: z.enum(NODE_TYPES) });

export function listByTypeHandler(deps: { store: ProjectStore }) {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = ListByTypeInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const nodes = await deps.store.findNodesByType(parsed.data.type);
    return { ok: true, output: JSON.stringify(nodes) };
  };
}
