import { promises as fs } from 'node:fs';
import path from 'node:path';

// Playwright の global setup: TALLY_HOME を初期化し、sample-project をコピーして
// registry.yaml に登録する。dev server は playwright.config の webServer で TALLY_HOME
// を同じ値に向けて起動する前提。
export default async function globalSetup(): Promise<void> {
  const tallyHome = path.resolve(__dirname, '..', '.playwright-tally-home');
  const projectsRoot = path.join(tallyHome, 'projects');
  const repoRoot = path.resolve(__dirname, '..', '..', '..');
  const sampleSrc = path.join(repoRoot, 'examples', 'sample-project');
  const sampleDst = path.join(projectsRoot, 'taskflow-invite');

  // 毎回クリーンな状態から始める (前回ドラッグで位置が変わっていても reset)。
  await fs.rm(tallyHome, { recursive: true, force: true });
  await fs.mkdir(projectsRoot, { recursive: true });
  await copyDir(sampleSrc, sampleDst);

  // registry.yaml を手書き (schema は RegistrySchema と揃える)。
  const now = new Date().toISOString();
  const registry = [
    'version: 1',
    'projects:',
    '  - id: taskflow-invite',
    `    path: ${sampleDst}`,
    `    lastOpenedAt: ${now}`,
    '',
  ].join('\n');
  await fs.writeFile(path.join(tallyHome, 'registry.yaml'), registry, 'utf8');
}

async function copyDir(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) await copyDir(s, d);
    else if (e.isFile()) await fs.copyFile(s, d);
  }
}
