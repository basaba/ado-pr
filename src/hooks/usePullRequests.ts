import { useState, useEffect, useCallback } from 'react';
import type { PullRequest } from '../types';
import type { PrSearchFilters } from '../api/pullRequests';
import { searchPullRequests } from '../api';

export function usePullRequests(filters?: PrSearchFilters, creatorIds?: string[]) {
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Serialize filters to a stable string for dependency tracking
  const filterKey = JSON.stringify(filters ?? {});
  const creatorsKey = JSON.stringify(creatorIds ?? []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (creatorIds && creatorIds.length > 0) {
        // Parallel fetch per author, merge + dedup
        const results = await Promise.all(
          creatorIds.map((id) => searchPullRequests({ ...filters, creatorId: id })),
        );
        const merged = results.flat();
        const seen = new Set<number>();
        const deduped = merged.filter((pr) => {
          if (seen.has(pr.pullRequestId)) return false;
          seen.add(pr.pullRequestId);
          return true;
        });
        deduped.sort((a, b) => new Date(b.creationDate).getTime() - new Date(a.creationDate).getTime());
        setPullRequests(deduped);
      } else {
        const prs = await searchPullRequests(filters);
        setPullRequests(prs);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load PRs');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, creatorsKey]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { pullRequests, loading, error, refresh };
}
