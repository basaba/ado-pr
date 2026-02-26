import { useState, useEffect, useCallback } from 'react';
import type { PullRequestIteration, IterationChange } from '../types';
import { listIterations, getIterationChanges, getFileContent } from '../api';

export function useDiff(repoId: string, prId: number) {
  const [iterations, setIterations] = useState<PullRequestIteration[]>([]);
  const [changes, setChanges] = useState<IterationChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!repoId || !prId) return;
    setLoading(true);
    setError(null);
    try {
      const iters = await listIterations(repoId, prId);
      setIterations(iters);
      if (iters.length > 0) {
        const lastIter = iters[iters.length - 1];
        const ch = await getIterationChanges(repoId, prId, lastIter.id);
        setChanges(ch);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diffs');
    } finally {
      setLoading(false);
    }
  }, [repoId, prId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const fetchFilePair = useCallback(
    async (path: string) => {
      if (!iterations.length) return { oldContent: '', newContent: '' };
      const lastIter = iterations[iterations.length - 1];
      const [oldContent, newContent] = await Promise.all([
        getFileContent(repoId, path, lastIter.targetRefCommit.commitId),
        getFileContent(repoId, path, lastIter.sourceRefCommit.commitId),
      ]);
      return { oldContent, newContent };
    },
    [repoId, iterations],
  );

  return { iterations, changes, loading, error, refresh, fetchFilePair };
}
