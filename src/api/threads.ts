import { adoClient } from './client';
import type {
  AdoListResponse,
  PullRequestThread,
  ThreadComment,
  ThreadStatus,
} from '../types';

const basePath = (repoId: string, prId: number) =>
  `/git/repositories/${repoId}/pullrequests/${prId}/threads`;

export async function listThreads(
  repoId: string,
  prId: number,
): Promise<PullRequestThread[]> {
  const data = await adoClient.get<AdoListResponse<PullRequestThread>>(
    basePath(repoId, prId),
  );
  return data.value.filter((t) => !t.isDeleted);
}

export async function createThread(
  repoId: string,
  prId: number,
  content: string,
  threadContext?: PullRequestThread['threadContext'],
): Promise<PullRequestThread> {
  return adoClient.post<PullRequestThread>(basePath(repoId, prId), {
    comments: [{ parentCommentId: 0, content, commentType: 1 }],
    status: 'active',
    threadContext,
  });
}

export async function replyToThread(
  repoId: string,
  prId: number,
  threadId: number,
  content: string,
): Promise<ThreadComment> {
  return adoClient.post<ThreadComment>(
    `${basePath(repoId, prId)}/${threadId}/comments`,
    { content, parentCommentId: 0, commentType: 1 },
  );
}

export async function updateThreadStatus(
  repoId: string,
  prId: number,
  threadId: number,
  status: ThreadStatus,
): Promise<PullRequestThread> {
  return adoClient.patch<PullRequestThread>(
    `${basePath(repoId, prId)}/${threadId}`,
    { status },
  );
}

export async function deleteComment(
  repoId: string,
  prId: number,
  threadId: number,
  commentId: number,
): Promise<void> {
  await adoClient.delete(
    `${basePath(repoId, prId)}/${threadId}/comments/${commentId}`,
  );
}
