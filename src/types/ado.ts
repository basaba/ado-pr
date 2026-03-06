// ADO REST API TypeScript types

export interface AdoConfig {
  orgUrl: string;    // e.g. https://dev.azure.com/myorg
  project: string;
  pat: string;
  repoPath?: string; // optional local repo path for Copilot file access
}

export interface IdentityRef {
  id: string;
  displayName: string;
  uniqueName: string;
  imageUrl?: string;
}

export interface GitRepository {
  id: string;
  name: string;
  url: string;
  project: { id: string; name: string };
}

export interface PullRequest {
  pullRequestId: number;
  title: string;
  description: string;
  status: 'active' | 'completed' | 'abandoned';
  createdBy: IdentityRef;
  creationDate: string;
  sourceRefName: string;
  targetRefName: string;
  repository: GitRepository;
  reviewers: Reviewer[];
  mergeStatus: string;
  isDraft: boolean;
  url: string;
  labels?: { id: string; name: string }[];
  autoCompleteSetBy?: IdentityRef;
  lastMergeSourceCommit?: { commitId: string };
  completionOptions?: PullRequestCompletionOptions;
}

export interface PullRequestCompletionOptions {
  deleteSourceBranch?: boolean;
  mergeStrategy?: 'noFastForward' | 'squash' | 'rebase' | 'rebaseMerge';
  transitionWorkItems?: boolean;
}

export interface Reviewer extends IdentityRef {
  vote: number; // 10=approved, 5=approvedWithSuggestions, 0=noVote, -5=waitingForAuthor, -10=rejected
  isRequired?: boolean;
  hasDeclined?: boolean;
  isContainer?: boolean;
}

export interface PullRequestThread {
  id: number;
  status: ThreadStatus;
  comments: ThreadComment[];
  threadContext?: {
    filePath: string;
    rightFileStart?: { line: number; offset: number };
    rightFileEnd?: { line: number; offset: number };
    leftFileStart?: { line: number; offset: number };
    leftFileEnd?: { line: number; offset: number };
  };
  publishedDate: string;
  lastUpdatedDate: string;
  properties?: Record<string, { $value: string }>;
  isDeleted?: boolean;
}

export type ThreadStatus =
  | 'unknown'
  | 'active'
  | 'fixed'
  | 'wontFix'
  | 'closed'
  | 'byDesign'
  | 'pending';

export interface ThreadComment {
  id: number;
  content: string;
  author: IdentityRef;
  publishedDate: string;
  lastUpdatedDate: string;
  commentType: 'text' | 'system';
  parentCommentId?: number;
}

export interface PullRequestIteration {
  id: number;
  description: string;
  author: IdentityRef;
  createdDate: string;
  sourceRefCommit: { commitId: string };
  targetRefCommit: { commitId: string };
}

export interface IterationChange {
  changeId: number;
  item: {
    path: string;
    url?: string;
    objectId?: string;
    originalObjectId?: string;
  } | null;
  changeType: 'add' | 'edit' | 'delete' | 'rename';
  originalPath?: string;
}

export interface FileDiffBlock {
  changeType: number; // 0=none, 1=add, 2=delete
  mLine: number;
  mLinesCount: number;
  oLine: number;
  oLinesCount: number;
}

export interface FileDiffResponse {
  originalFile?: { url: string };
  modifiedFile?: { url: string };
  blocks: FileDiffBlock[];
}

export interface AdoListResponse<T> {
  value: T[];
  count: number;
}

export interface PolicyEvaluation {
  evaluationId: string;
  configuration: {
    id: number;
    type: { id: string; displayName: string };
    isEnabled: boolean;
    isBlocking: boolean;
    settings?: Record<string, unknown>;
  };
  status: 'queued' | 'running' | 'approved' | 'rejected' | 'notApplicable' | 'broken';
  context?: {
    buildId?: number;
    buildDefinitionName?: string;
    isExpired?: boolean;
  };
}

export type VoteValue = 10 | 5 | 0 | -5 | -10;

export const VOTE_LABELS: Record<number, string> = {
  10: 'Approved',
  5: 'Approved with suggestions',
  0: 'No vote',
  '-5': 'Waiting for author',
  '-10': 'Rejected',
};

export const VOTE_COLORS: Record<number, string> = {
  10: 'text-green-600',
  5: 'text-green-500',
  0: 'text-gray-400',
  '-5': 'text-yellow-500',
  '-10': 'text-red-600',
};
