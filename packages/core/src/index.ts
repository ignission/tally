export const PACKAGE_NAME = '@tally/core';

export * from './types';
export {
  ChatBlockSchema,
  ChatMessageSchema,
  ChatThreadMetaSchema,
  ChatThreadSchema,
  EDGE_TYPES,
  EdgeSchema,
  NODE_TYPES,
  NodeSchema,
  ProjectMetaPatchSchema,
  ProjectMetaSchema,
  ProjectSchema,
  QUALITY_CATEGORIES,
  REQUIREMENT_KINDS,
  REQUIREMENT_PRIORITIES,
  RequirementNodeSchema,
  UseCaseNodeSchema,
  UserStoryNodeSchema,
  QuestionNodeSchema,
  CodeRefNodeSchema,
  IssueNodeSchema,
  ProposalNodeSchema,
} from './schema';
export { EDGE_META, NODE_META } from './meta';
export type { EdgeMeta, NodeMeta } from './meta';
export {
  newChatId,
  newChatMessageId,
  newEdgeId,
  newNodeId,
  newProjectId,
  newQuestionOptionId,
  newToolUseId,
} from './id';
export { getSelectedOption, isDecided } from './logic/question';
export { computeStoryProgress, isStoryComplete } from './logic/story';
export type { StoryProgress } from './logic/story';
export { stripAiPrefix } from './logic/prefix';
