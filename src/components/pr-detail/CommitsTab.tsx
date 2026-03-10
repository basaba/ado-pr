import { useState } from 'react';
import type { GitCommitRef } from '../../types';
import { Spinner, ErrorBanner } from '../common';
import { adoClient } from '../../api';
import { formatDate } from '../../utils';
import { CommitDiffView } from './CommitDiffView';

interface Props {
  commits: GitCommitRef[];
  loading: boolean;
  error: string | null;
  repoId: string;
  repoName: string;
}

function shortSha(commitId: string) {
  return commitId.slice(0, 8);
}

function commitUrl(repoName: string, commitId: string): string {
  return `${adoClient.orgUrl}/${encodeURIComponent(adoClient.projectName)}/_git/${encodeURIComponent(repoName)}/commit/${commitId}`;
}

export function CommitsTab({ commits, loading, error, repoId, repoName }: Props) {
  const [selectedCommitId, setSelectedCommitId] = useState<string | null>(null);

  if (loading) return <Spinner className="mt-10" />;
  if (error) return <ErrorBanner message={error} />;
  if (commits.length === 0) {
    return (
      <p className="text-sm text-gray-500 dark:text-gray-400">
        No commits found for this pull request.
      </p>
    );
  }

  const selectedCommit = selectedCommitId
    ? commits.find((c) => c.commitId === selectedCommitId)
    : null;

  if (selectedCommit) {
    return (
      <div>
        {/* Commit header with back button */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          <button
            onClick={() => setSelectedCommitId(null)}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline shrink-0"
          >
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {selectedCommit.comment.split('\n')[0]}
            </div>
            <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 flex flex-wrap gap-x-3">
              <span>{selectedCommit.author.name}</span>
              <span>{formatDate(selectedCommit.author.date)}</span>
              <a
                href={commitUrl(repoName, selectedCommit.commitId)}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-blue-600 dark:text-blue-400 hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                {shortSha(selectedCommit.commitId)}
              </a>
            </div>
          </div>
        </div>

        <CommitDiffView repoId={repoId} commitId={selectedCommit.commitId} />
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="text-sm text-gray-500 dark:text-gray-400 mb-4">
        {commits.length} commit{commits.length !== 1 ? 's' : ''}
      </div>

      <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
        {commits.map((commit) => (
          <div
            key={commit.commitId}
            className="flex items-start gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
            onClick={() => setSelectedCommitId(commit.commitId)}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100">
                {commit.comment.split('\n')[0]}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-1">
                <span>{commit.author.name}</span>
                <span>{formatDate(commit.author.date)}</span>
                {commit.changeCounts && (
                  <span className="flex gap-2">
                    {commit.changeCounts.Add > 0 && (
                      <span className="text-green-600 dark:text-green-400">
                        +{commit.changeCounts.Add}
                      </span>
                    )}
                    {commit.changeCounts.Edit > 0 && (
                      <span className="text-yellow-600 dark:text-yellow-400">
                        ~{commit.changeCounts.Edit}
                      </span>
                    )}
                    {commit.changeCounts.Delete > 0 && (
                      <span className="text-red-600 dark:text-red-400">
                        -{commit.changeCounts.Delete}
                      </span>
                    )}
                  </span>
                )}
              </div>
            </div>
            <button
              className="shrink-0 font-mono text-xs text-blue-600 dark:text-blue-400 hover:underline bg-gray-50 dark:bg-gray-700 px-2 py-1 rounded"
              title={commit.commitId}
              onClick={() => setSelectedCommitId(commit.commitId)}
            >
              {shortSha(commit.commitId)}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
