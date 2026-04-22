export const PACKAGE_NAME = '@tally/core';

export {
  newChatId,
  newChatMessageId,
  newEdgeId,
  newNodeId,
  newProjectId,
  newQuestionOptionId,
  newToolUseId,
} from './id';
export { stripAiPrefix } from './logic/prefix';
export { getSelectedOption, isDecided } from './logic/question';
export type { StoryProgress } from './logic/story';
export { computeStoryProgress, isStoryComplete } from './logic/story';
export type { EdgeMeta, NodeMeta } from './meta';
export { EDGE_META, NODE_META } from './meta';
export type { Codebase } from './schema';
export {
  ChatBlockSchema,
  ChatMessageSchema,
  ChatThreadMetaSchema,
  ChatThreadSchema,
  CodebaseSchema,
  CodeRefNodeSchema,
  EDGE_TYPES,
  EdgeSchema,
  IssueNodeSchema,
  NODE_TYPES,
  NodeSchema,
  ProjectMetaPatchSchema,
  ProjectMetaSchema,
  ProjectSchema,
  ProposalNodeSchema,
  QUALITY_CATEGORIES,
  QuestionNodeSchema,
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
  RequirementNodeSchema,
  UseCaseNodeSchema,
  UserStoryNodeSchema,
} from './schema';
export * from './types';
