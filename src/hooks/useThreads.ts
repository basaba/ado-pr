import { useState, useEffect, useCallback } from 'react';
import type { PullRequestThread } from '../types';
import { listThreads, createThread, replyToThread, updateThreadStatus, deleteComment, likeComment, unlikeComment } from '../api';
import type { ThreadStatus } from '../types';
import { isTextComment } from '../utils';

export function useThreads(repoId: string, prId: number) {
  const [threads, setThreads] = useState<PullRequestThread[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repoId || !prId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await listThreads(repoId, prId);
      setThreads(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load threads');
    } finally {
      setLoading(false);
    }
  }, [repoId, prId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const addThread = useCallback(
    async (content: string, threadContext?: PullRequestThread['threadContext']) => {
      const thread = await createThread(repoId, prId, content, threadContext);
      setThreads((prev) => [...prev, thread]);
      return thread;
    },
    [repoId, prId],
  );

  const reply = useCallback(
    async (threadId: number, content: string) => {
      const comment = await replyToThread(repoId, prId, threadId, content);
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId ? { ...t, comments: [...t.comments, comment] } : t,
        ),
      );
    },
    [repoId, prId],
  );

  const setStatus = useCallback(
    async (threadId: number, status: ThreadStatus) => {
      await updateThreadStatus(repoId, prId, threadId, status);
      setThreads((prev) =>
        prev.map((t) => (t.id === threadId ? { ...t, status } : t)),
      );
    },
    [repoId, prId],
  );

  const removeComment = useCallback(
    async (threadId: number, commentId: number) => {
      await deleteComment(repoId, prId, threadId, commentId);
      setThreads((prev) =>
        prev
          .map((t) =>
            t.id === threadId
              ? { ...t, comments: t.comments.filter((c) => c.id !== commentId) }
              : t,
          )
          .filter((t) => t.comments.some((c) => isTextComment(c.commentType))),
      );
    },
    [repoId, prId],
  );

  const toggleLike = useCallback(
    async (threadId: number, commentId: number, currentUserId: string) => {
      setThreads((prev) =>
        prev.map((t) => {
          if (t.id !== threadId) return t;
          return {
            ...t,
            comments: t.comments.map((c) => {
              if (c.id !== commentId) return c;
              const liked = c.usersLiked ?? [];
              const alreadyLiked = liked.some((u) => u.id === currentUserId);
              return {
                ...c,
                usersLiked: alreadyLiked
                  ? liked.filter((u) => u.id !== currentUserId)
                  : [...liked, { id: currentUserId, displayName: '', uniqueName: '' }],
              };
            }),
          };
        }),
      );

      const comment = threads
        .find((t) => t.id === threadId)
        ?.comments.find((c) => c.id === commentId);
      const alreadyLiked = comment?.usersLiked?.some((u) => u.id === currentUserId) ?? false;

      try {
        if (alreadyLiked) {
          await unlikeComment(repoId, prId, threadId, commentId);
        } else {
          await likeComment(repoId, prId, threadId, commentId);
        }
      } catch {
        await refresh();
      }
    },
    [repoId, prId, threads, refresh],
  );

  return { threads, loading, error, refresh, addThread, reply, setStatus, removeComment, toggleLike };
}
