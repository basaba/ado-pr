import { useState, useEffect, useCallback } from 'react';
import { getCommitDetails, getCommitChanges } from '../api/commits';
import { getFileContent } from '../api/diffs';
import type { CommitChangeNormalized } from '../api/commits';

export function useCommitDiff(repoId: string, commitId: string | null) {
  const [changes, setChanges] = useState<CommitChangeNormalized[]>([]);
  const [parentCommitId, setParentCommitId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!commitId || !repoId) {
      setChanges([]);
      setParentCommitId(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const [details, changesData] = await Promise.all([
        getCommitDetails(repoId, commitId),
        getCommitChanges(repoId, commitId),
      ]);
      setParentCommitId(details.parents?.[0] ?? null);
      setChanges(changesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load commit changes');
    } finally {
      setLoading(false);
    }
  }, [repoId, commitId]);

  useEffect(() => {
    load();
  }, [load]);

  const fetchFilePair = useCallback(
    async (path: string, changeType?: string) => {
      if (!commitId) return { oldContent: '', newContent: '' };

      const oldContent = changeType === 'add' || !parentCommitId
        ? ''
        : await getFileContent(repoId, path, parentCommitId);
      const newContent = changeType === 'delete'
        ? ''
        : await getFileContent(repoId, path, commitId);

      return { oldContent, newContent };
    },
    [repoId, commitId, parentCommitId],
  );

  return { changes, loading, error, fetchFilePair };
}
