import { useState, useEffect, useCallback } from 'react';
import type { PullRequest } from '../types';
import type { PrSearchFilters } from '../api/pullRequests';
import { searchPullRequests } from '../api';

export function usePullRequests(filters?: PrSearchFilters) {
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serialize filters to a stable string for dependency tracking
  const filterKey = JSON.stringify(filters ?? {});

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const prs = await searchPullRequests(filters);
      setPullRequests(prs);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PRs');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pullRequests, loading, error, refresh };
}
