import type { ProjectStore } from '@tally/storage';
import { z } from 'zod';

import type { ToolResult } from './create-node';

export const FindRelatedInputSchema = z.object({ nodeId: z.string().min(1) });

export function findRelatedHandler(deps: { store: ProjectStore }) {
  return async (input: unknown): Promise<ToolResult> => {
    const parsed = FindRelatedInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, output: `invalid input: ${parsed.error.message}` };
    }
    const related = await deps.store.findRelatedNodes(parsed.data.nodeId);
    return { ok: true, output: JSON.stringify(related) };
  };
}
