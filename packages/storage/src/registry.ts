import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import yaml from 'yaml';
import { z } from 'zod';
import { atomicWriteFile, readYaml } from './yaml';

// ---------------------------------------------------------------------------
// パス解決
// ---------------------------------------------------------------------------

// $TALLY_HOME > $XDG_DATA_HOME/tally > ~/.local/share/tally
export function resolveTallyHome(): string {
  if (process.env.TALLY_HOME) return process.env.TALLY_HOME;
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg) return path.join(xdg, 'tally');
  return path.join(os.homedir(), '.local', 'share', 'tally');
}

export function resolveRegistryPath(): string {
  return path.join(resolveTallyHome(), 'registry.yaml');
}

export function resolveDefaultProjectsRoot(): string {
  return path.join(resolveTallyHome(), 'projects');
}

// ---------------------------------------------------------------------------
// スキーマ
// ---------------------------------------------------------------------------

export const RegistryEntrySchema = z.object({
  id: z.string().min(1),
  path: z.string().min(1),
  lastOpenedAt: z.string().min(1),
});

export const RegistrySchema = z.object({
  version: z.literal(1),
  projects: z.array(RegistryEntrySchema),
});

export type RegistryEntry = z.infer<typeof RegistryEntrySchema>;
export type Registry = z.infer<typeof RegistrySchema>;

const EMPTY_REGISTRY: Registry = { version: 1, projects: [] };

// ---------------------------------------------------------------------------
// load / save
// ---------------------------------------------------------------------------

export async function loadRegistry(): Promise<Registry> {
  const filePath = resolveRegistryPath();
  const loaded = await readYaml(filePath, RegistrySchema);
  return loaded ?? EMPTY_REGISTRY;
}

export async function saveRegistry(reg: Registry): Promise<void> {
  const filePath = resolveRegistryPath();
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const dump = yaml.stringify(RegistrySchema.parse(reg));
  await atomicWriteFile(filePath, dump);
}
