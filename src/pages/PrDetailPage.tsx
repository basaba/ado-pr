import { useState, useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getPullRequest, votePullRequest, completePullRequest, abandonPullRequest, setAutoComplete, cancelAutoComplete } from '../api';
import { useAuth } from '../context';
import { useThreads, useDiff } from '../hooks';
import type { PullRequest, VoteValue } from '../types';
import { Spinner, ErrorBanner, Button, Badge, SplitButton } from '../components/common';
import { VOTE_LABELS, VOTE_COLORS } from '../types';
import { formatDate, branchName, buildUsersMap } from '../utils';
import { OverviewTab } from '../components/pr-detail/OverviewTab';
import { FilesTab } from '../components/pr-detail/FilesTab';
import type { FileNavigateTarget } from '../components/pr-detail/FilesTab';
import { ThreadsTab } from '../components/pr-detail/ThreadsTab';

type Tab = 'overview' | 'files' | 'threads';

export function PrDetailPage() {
  const { repoId, prId } = useParams<{ repoId: string; prId: string }>();
  const { profile } = useAuth();
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [voting, setVoting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [fileNavTarget, setFileNavTarget] = useState<FileNavigateTarget | null>(null);

  const threads = useThreads(repoId!, Number(prId));
  const diff = useDiff(repoId!, Number(prId));

  useEffect(() => {
    if (!repoId || !prId) return;
    setLoading(true);
    getPullRequest(repoId, Number(prId))
      .then(setPr)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [repoId, prId]);

  const usersMap = useMemo(
    () => buildUsersMap(threads.threads, pr?.reviewers, pr?.createdBy),
    [threads.threads, pr],
  );

  if (loading) return <Spinner className="mt-20" />;
  if (error || !pr) return <ErrorBanner message={error || 'PR not found'} />;

  const myReview = pr.reviewers.find((r) => r.id === profile?.id);
  const myVote = myReview?.vote ?? 0;
  const isMyPr = profile?.id === pr.createdBy.id;
  const isActive = pr.status === 'active';
  const hasAutoComplete = !!pr.autoCompleteSetBy?.id;

  const handleVote = async (vote: VoteValue) => {
    if (!profile) return;
    setVoting(true);
    try {
      await votePullRequest(repoId!, pr.pullRequestId, profile.id, vote);
      setPr((prev) =>
        prev
          ? {
              ...prev,
              reviewers: prev.reviewers.map((r) =>
                r.id === profile.id ? { ...r, vote } : r,
              ),
            }
          : prev,
      );
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Vote failed');
    } finally {
      setVoting(false);
    }
  };

  const handleComplete = async () => {
    if (!pr.lastMergeSourceCommit?.commitId) {
      alert('Cannot complete: no merge source commit found.');
      return;
    }
    if (!confirm('Complete this pull request?')) return;
    setActionLoading(true);
    try {
      const updated = await completePullRequest(repoId!, pr.pullRequestId, pr.lastMergeSourceCommit.commitId);
      setPr(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Complete failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleAbandon = async () => {
    if (!confirm('Abandon this pull request?')) return;
    setActionLoading(true);
    try {
      const updated = await abandonPullRequest(repoId!, pr.pullRequestId);
      setPr(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Abandon failed');
    } finally {
      setActionLoading(false);
    }
  };

  const handleToggleAutoComplete = async () => {
    if (!profile) return;
    setActionLoading(true);
    try {
      const updated = hasAutoComplete
        ? await cancelAutoComplete(repoId!, pr.pullRequestId)
        : await setAutoComplete(repoId!, pr.pullRequestId, profile.id);
      setPr(updated);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Autocomplete toggle failed');
    } finally {
      setActionLoading(false);
    }
  };

  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'files', label: 'Files', count: diff.changes.length },
    {
      id: 'threads',
      label: 'Threads',
      count: threads.threads.filter((t) => t.status === 'active').length,
    },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <Link to="/" className="text-sm text-blue-600 hover:underline">
          ← Back to list
        </Link>
      </div>

      <div className="bg-white rounded-lg shadow p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
              {pr.title}
              {pr.isDraft && <Badge text="Draft" color="bg-gray-200 text-gray-600" />}
            </h1>
            <div className="text-sm text-gray-500 mt-1 flex gap-3">
              <span>{pr.repository.name}</span>
              <span>
                {branchName(pr.sourceRefName)} → {branchName(pr.targetRefName)}
              </span>
              <span>by {pr.createdBy.displayName}</span>
              <span>{formatDate(pr.creationDate)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-sm font-medium ${VOTE_COLORS[myVote]}`}>
              {VOTE_LABELS[myVote]}
            </span>
          </div>
        </div>

        {/* Vote button */}
        <div className="flex gap-2 mt-4 border-t border-gray-100 pt-4">
          <SplitButton
            disabled={voting}
            size="sm"
            options={[
              { label: '✓ Approve', onClick: () => handleVote(10), variant: 'success' },
              { label: '👍 Approve w/ Suggestions', onClick: () => handleVote(5), variant: 'primary' },
              { label: '⏳ Wait for Author', onClick: () => handleVote(-5), variant: 'warning' },
              { label: '✗ Reject', onClick: () => handleVote(-10), variant: 'danger' },
              ...(myVote !== 0 ? [{ label: '↺ Reset Vote', onClick: () => handleVote(0), variant: 'ghost' as const }] : []),
            ]}
          />
        </div>

        {/* PR actions for owner */}
        {isMyPr && isActive && (
          <div className="flex gap-2 mt-3 border-t border-gray-100 pt-3 items-center">
            <SplitButton
              disabled={actionLoading}
              size="sm"
              options={[
                { label: 'Complete', onClick: handleComplete, variant: 'success' },
                { label: hasAutoComplete ? 'Cancel Autocomplete' : 'Set Autocomplete', onClick: handleToggleAutoComplete },
                { label: 'Abandon', onClick: handleAbandon },
              ]}
            />
            {hasAutoComplete && (
              <span className="text-xs text-blue-600 ml-1">
                Autocomplete is on
              </span>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-lg shadow">
        <div className="flex border-b border-gray-200">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 px-2 py-0.5 text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className={activeTab === 'files' ? 'p-0' : 'p-6'}>
          {activeTab === 'overview' && (
            <OverviewTab pr={pr} threads={threads} usersMap={usersMap} currentUserId={profile?.id} />
          )}
          {activeTab === 'files' && (
            <FilesTab
              diff={diff}
              threads={threads}
              repoId={repoId!}
              prId={Number(prId)}
              usersMap={usersMap}
              navigateTarget={fileNavTarget}
              onNavigateHandled={() => setFileNavTarget(null)}
              currentUserId={profile?.id}
            />
          )}
          {activeTab === 'threads' && (
            <ThreadsTab
              threads={threads}
              usersMap={usersMap}
              currentUserId={profile?.id}
              onNavigateToFile={(filePath, line) => {
                setFileNavTarget({ filePath, line });
                setActiveTab('files');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}
