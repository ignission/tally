import type { NodeTypes } from '@xyflow/react';

import { CodeRefNodeView } from './coderef-node';
import { IssueNodeView } from './issue-node';
import { ProposalNodeView } from './proposal-node';
import { QuestionNodeView } from './question-node';
import { RequirementNodeView } from './requirement-node';
import { UseCaseNodeView } from './usecase-node';
import { UserStoryNodeView } from './userstory-node';

// React Flow に渡すノード種別 → レンダラのマップ。
// 識別子はそのまま NodeType の文字列を流用。
export const nodeTypes: NodeTypes = {
  requirement: RequirementNodeView,
  usecase: UseCaseNodeView,
  userstory: UserStoryNodeView,
  question: QuestionNodeView,
  coderef: CodeRefNodeView,
  issue: IssueNodeView,
  proposal: ProposalNodeView,
};
