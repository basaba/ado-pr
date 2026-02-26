import { useState, useEffect, useCallback } from 'react';
import type { PullRequestThread } from '../types';
import { listThreads, createThread, replyToThread, updateThreadStatus } from '../api';
import type { ThreadStatus } from '../types';

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

  return { threads, loading, error, refresh, addThread, reply, setStatus };
}
