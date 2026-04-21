export const PACKAGE_NAME = '@tally/storage';

export { FileSystemProjectStore } from './project-store';
export type { NodeDraft, NodePatch, ProjectStore } from './project-store';
export { FileSystemChatStore } from './chat-store';
export type { ChatStore, CreateChatInput } from './chat-store';
export {
  chatFileName,
  nodeFileName,
  resolveProjectPaths,
} from './project-dir';
export type { ProjectPaths } from './project-dir';
export { YamlValidationError, atomicWriteFile, readYaml, writeYaml } from './yaml';
export {
  listProjects,
  loadRegistry,
  registerProject,
  resolveDefaultProjectsRoot,
  resolveRegistryPath,
  resolveTallyHome,
  saveRegistry,
  touchProject,
  unregisterProject,
} from './registry';
export type { Registry, RegistryEntry } from './registry';
export { initProject } from './init-project';
export type { InitProjectInput, InitProjectResult } from './init-project';
export { clearProject } from './clear-project';
export type { ClearProjectResult } from './clear-project';
export {
  discoverProjects,
  listWorkspaceCandidates,
  loadProjectById,
  resolveProjectById,
} from './project-resolver';
export type { ProjectHandle, WorkspaceCandidate } from './project-resolver';
