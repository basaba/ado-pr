import { useState, useEffect, useCallback } from 'react';
import { listPrCommits } from '../api/commits';
import type { GitCommitRef } from '../types';

export function useCommits(repoId: string, prId: number) {
  const [commits, setCommits] = useState<GitCommitRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await listPrCommits(repoId, prId);
      setCommits(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [repoId, prId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { commits, loading, error, refresh };
}
