import { useNavigate } from 'react-router-dom';
import { usePullRequests } from '../hooks';
import { Spinner, ErrorBanner, Badge } from '../components/common';
import { VOTE_LABELS, VOTE_COLORS } from '../types';
import { formatDate, branchName } from '../utils';
import { useAuth } from '../context';

export function PrListPage() {
  const { pullRequests, loading, error, refresh } = usePullRequests();
  const { profile } = useAuth();
  const navigate = useNavigate();

  if (loading) return <Spinner className="mt-20" />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">
          Pull Requests for Review
        </h1>
        <button
          onClick={refresh}
          className="text-sm text-blue-600 hover:underline"
        >
          ↻ Refresh
        </button>
      </div>

      {pullRequests.length === 0 ? (
        <p className="text-gray-500 mt-10 text-center">
          No active pull requests assigned to you for review.
        </p>
      ) : (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {pullRequests.map((pr) => {
            const myReview = pr.reviewers.find((r) => r.id === profile?.id);
            const vote = myReview?.vote ?? 0;

            return (
              <div
                key={pr.pullRequestId}
                className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() =>
                  navigate(
                    `/pr/${pr.repository.id}/${pr.pullRequestId}`,
                  )
                }
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">
                      {pr.title}
                    </span>
                    {pr.isDraft && (
                      <Badge text="Draft" color="bg-gray-200 text-gray-600" />
                    )}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex gap-3">
                    <span>{pr.repository.name}</span>
                    <span>
                      {branchName(pr.sourceRefName)} → {branchName(pr.targetRefName)}
                    </span>
                    <span>by {pr.createdBy.displayName}</span>
                    <span>{formatDate(pr.creationDate)}</span>
                  </div>
                </div>
                <div className="ml-4 shrink-0">
                  <span className={`text-xs font-medium ${VOTE_COLORS[vote] || 'text-gray-400'}`}>
                    {VOTE_LABELS[vote] || 'No vote'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
