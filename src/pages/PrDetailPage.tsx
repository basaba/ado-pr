import { useState, useEffect, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { getPullRequest, votePullRequest, completePullRequest, abandonPullRequest, setAutoComplete, cancelAutoComplete, adoClient } from '../api';
import { useAuth } from '../context';
import { useThreads, useDiff, useCommits, useSearchParamState } from '../hooks';
import type { PullRequest, VoteValue } from '../types';
import { Spinner, ErrorBanner, Badge, SplitButton, ConfirmDialog, useToast } from '../components/common';
import { VOTE_LABELS, VOTE_COLORS } from '../types';
import { formatDate, branchName, buildUsersMap } from '../utils';
import { OverviewTab } from '../components/pr-detail/OverviewTab';
import { FilesTab } from '../components/pr-detail/FilesTab';
import type { FileNavigateTarget } from '../components/pr-detail/FilesTab';
import { ThreadsTab } from '../components/pr-detail/ThreadsTab';
import { PoliciesTab } from '../components/pr-detail/PoliciesTab';
import { CopilotTab } from '../components/pr-detail/CopilotTab';
import { CommitsTab } from '../components/pr-detail/CommitsTab';
import { ConflictsTab } from '../components/pr-detail/ConflictsTab';

type Tab = 'overview' | 'files' | 'threads' | 'commits' | 'policies' | 'conflicts' | 'copilot';

export function PrDetailPage() {
  const { repoId, prId } = useParams<{ repoId: string; prId: string }>();
  const { profile, config } = useAuth();
  const [pr, setPr] = useState<PullRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTabParam, setActiveTabParam] = useSearchParamState('tab', 'overview');
  const activeTab = activeTabParam as Tab;
  const setActiveTab = setActiveTabParam as (v: Tab) => void;
  const [voting, setVoting] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [fileNavTarget, setFileNavTarget] = useState<FileNavigateTarget | null>(null);

  const threads = useThreads(repoId!, Number(prId));
  const diff = useDiff(repoId!, Number(prId));
  const commits = useCommits(repoId!, Number(prId));

  useEffect(() => {
    if (!repoId || !prId) return;
    setLoading(true);
    getPullRequest(repoId, Number(prId))
      .then(setPr)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [repoId, prId]);

  const [mentionedUsers, setMentionedUsers] = useState<Record<string, string>>({});

  const usersMap = useMemo(
    () => ({ ...buildUsersMap(threads.threads, pr?.reviewers, pr?.createdBy), ...mentionedUsers }),
    [threads.threads, pr, mentionedUsers],
  );

  const knownUsers = useMemo(
    () => Object.entries(usersMap).map(([id, displayName]) => ({ id, displayName })),
    [usersMap],
  );

  const handleMentionInserted = useCallback((user: { id: string; displayName: string }) => {
    setMentionedUsers((prev) => ({ ...prev, [user.id.toLowerCase()]: user.displayName }));
  }, []);

  const { showToast } = useToast();
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string; message: string; confirmLabel: string;
    variant: 'primary' | 'danger'; onConfirm: () => void;
  } | null>(null);
  const closeConfirm = useCallback(() => setConfirmDialog(null), []);
  const [showAutoCompleteDialog, setShowAutoCompleteDialog] = useState(false);

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
      showToast(err instanceof Error ? err.message : 'Vote failed');
    } finally {
      setVoting(false);
    }
  };

  const handleComplete = async () => {
    if (!pr.lastMergeSourceCommit?.commitId) {
      showToast('Cannot complete: no merge source commit found.');
      return;
    }
    setConfirmDialog({
      title: 'Complete Pull Request',
      message: 'Are you sure you want to complete this pull request?',
      confirmLabel: 'Complete',
      variant: 'primary',
      onConfirm: async () => {
        setConfirmDialog(null);
        setActionLoading(true);
        try {
          const updated = await completePullRequest(repoId!, pr.pullRequestId, pr.lastMergeSourceCommit!.commitId, pr.completionOptions);
          setPr(updated);
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Complete failed');
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleAbandon = async () => {
    setConfirmDialog({
      title: 'Abandon Pull Request',
      message: 'Are you sure you want to abandon this pull request?',
      confirmLabel: 'Abandon',
      variant: 'danger',
      onConfirm: async () => {
        setConfirmDialog(null);
        setActionLoading(true);
        try {
          const updated = await abandonPullRequest(repoId!, pr.pullRequestId);
          setPr(updated);
        } catch (err) {
          showToast(err instanceof Error ? err.message : 'Abandon failed');
        } finally {
          setActionLoading(false);
        }
      },
    });
  };

  const handleToggleAutoComplete = async () => {
    if (!profile) return;
    if (hasAutoComplete) {
      setActionLoading(true);
      try {
        const updated = await cancelAutoComplete(repoId!, pr.pullRequestId);
        setPr(updated);
      } catch (err) {
        showToast(err instanceof Error ? err.message : 'Autocomplete toggle failed');
      } finally {
        setActionLoading(false);
      }
    } else {
      setShowAutoCompleteDialog(true);
    }
  };

  const handleAutoCompleteConfirm = async (options: import('../types').PullRequestCompletionOptions) => {
    if (!profile) return;
    setShowAutoCompleteDialog(false);
    setActionLoading(true);
    try {
      const updated = await setAutoComplete(repoId!, pr.pullRequestId, profile.id, options);
      setPr(updated);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Autocomplete toggle failed');
    } finally {
      setActionLoading(false);
    }
  };

  const hasConflicts = pr.mergeStatus === 'conflicts';

  const tabs: { id: Tab; label: string; count?: number; warn?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'files', label: 'Files', count: diff.changes.length },
    {
      id: 'threads',
      label: 'Threads',
      count: threads.threads.filter((t) => t.status === 'active').length,
    },
    { id: 'commits', label: 'Commits', count: commits.commits.length },
    { id: 'policies', label: 'Policies' },
    ...(hasConflicts ? [{ id: 'conflicts' as const, label: 'Conflicts', warn: true }] : []),
    { id: 'copilot', label: 'Copilot' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-4">
        <Link to="/" className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          ← Back to list
        </Link>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 mb-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              {pr.title}
              {pr.isDraft && <Badge text="Draft" color="bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300" />}
              <button
                type="button"
                title="Copy PR link"
                onClick={async () => {
                  const prUrl = `${adoClient.orgUrl}/${encodeURIComponent(adoClient.projectName)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`;
                  try {
                    await navigator.clipboard.writeText(prUrl);
                    showToast('PR link copied to clipboard', 'success');
                  } catch {
                    showToast('Failed to copy link');
                  }
                }}
                className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
                  <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
                </svg>
              </button>
            </h1>
            <div className="text-sm text-gray-500 dark:text-gray-400 mt-1 flex gap-3">
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

        {/* Vote & PR actions */}
        <div className="flex gap-2 mt-4 border-t border-gray-100 dark:border-gray-700 pt-4 items-center flex-wrap">
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
          {isMyPr && isActive && (
            <>
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
                <Badge text="Autocomplete" color="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300" />
              )}
            </>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow">
        <div className="flex border-b border-gray-200 dark:border-gray-700 sticky top-0 z-20 bg-white dark:bg-gray-800 rounded-t-lg">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 dark:border-blue-400 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {tab.label}
              {tab.warn && (
                <span className="ml-1.5 rounded-full bg-red-100 dark:bg-red-900 text-red-600 dark:text-red-400 px-2 py-0.5 text-xs font-semibold">
                  !
                </span>
              )}
              {tab.count != null && tab.count > 0 && (
                <span className="ml-1.5 rounded-full bg-gray-100 dark:bg-gray-700 px-2 py-0.5 text-xs">
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className={activeTab === 'files' || activeTab === 'copilot' || activeTab === 'commits' || activeTab === 'conflicts' ? 'p-0' : 'p-6'}>
          {activeTab === 'overview' && (
            <OverviewTab pr={pr} threads={threads} usersMap={usersMap} currentUserId={profile?.id} knownUsers={knownUsers} onMentionInserted={handleMentionInserted} />
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
              isPrOwner={profile?.id === pr.createdBy.id}
              onMentionInserted={handleMentionInserted}
            />
          )}
          {activeTab === 'threads' && (
            <ThreadsTab
              threads={threads}
              usersMap={usersMap}
              currentUserId={profile?.id}
              isPrOwner={profile?.id === pr.createdBy.id}
              knownUsers={knownUsers}
              onMentionInserted={handleMentionInserted}
              onNavigateToFile={(filePath, line) => {
                setFileNavTarget({ filePath, line });
                setActiveTab('files');
              }}
            />
          )}
          {activeTab === 'policies' && (
            <PoliciesTab prId={Number(prId)} repoName={pr.repository.name} />
          )}
          {activeTab === 'commits' && (
            <CommitsTab
              commits={commits.commits}
              loading={commits.loading}
              error={commits.error}
              repoId={repoId!}
              repoName={pr.repository.name}
            />
          )}
          {activeTab === 'copilot' && (
            <CopilotTab pr={pr} />
          )}
          {activeTab === 'conflicts' && (
            <ConflictsTab
              repoPath={config?.repoPath ?? ''}
              sourceBranch={pr.sourceRefName}
              targetBranch={pr.targetRefName}
              onRefreshPr={() => {
                getPullRequest(repoId!, Number(prId)).then(setPr).catch(() => {});
              }}
            />
          )}
        </div>
      </div>
      <ConfirmDialog
        open={confirmDialog !== null}
        title={confirmDialog?.title ?? ''}
        message={confirmDialog?.message ?? ''}
        confirmLabel={confirmDialog?.confirmLabel}
        variant={confirmDialog?.variant}
        onConfirm={confirmDialog?.onConfirm ?? closeConfirm}
        onCancel={closeConfirm}
      />
      <AutoCompleteDialog
        open={showAutoCompleteDialog}
        defaults={pr.completionOptions}
        onConfirm={handleAutoCompleteConfirm}
        onCancel={() => setShowAutoCompleteDialog(false)}
      />
    </div>
  );
}

function AutoCompleteDialog({
  open,
  defaults,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  defaults?: import('../types').PullRequestCompletionOptions;
  onConfirm: (options: import('../types').PullRequestCompletionOptions) => void;
  onCancel: () => void;
}) {
  const [mergeStrategy, setMergeStrategy] = useState(defaults?.mergeStrategy ?? 'squash');
  const [deleteSourceBranch, setDeleteSourceBranch] = useState(defaults?.deleteSourceBranch ?? true);
  const [transitionWorkItems, setTransitionWorkItems] = useState(defaults?.transitionWorkItems ?? true);

  // Sync defaults when dialog opens with fresh PR data
  useEffect(() => {
    if (open) {
      setMergeStrategy(defaults?.mergeStrategy ?? 'squash');
      setDeleteSourceBranch(defaults?.deleteSourceBranch ?? true);
      setTransitionWorkItems(defaults?.transitionWorkItems ?? true);
    }
  }, [open, defaults]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onCancel]);

  if (!open) return null;

  const strategies: { value: string; label: string }[] = [
    { value: 'squash', label: 'Squash commit' },
    { value: 'noFastForward', label: 'Merge (no fast-forward)' },
    { value: 'rebase', label: 'Rebase' },
    { value: 'rebaseMerge', label: 'Rebase and merge' },
  ];

  return createPortal(
    <div className="fixed inset-0 z-[10000] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-sm w-full mx-4 p-5">
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Set Autocomplete</h3>

        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Merge strategy</label>
            <select
              value={mergeStrategy}
              onChange={(e) => setMergeStrategy(e.target.value as typeof mergeStrategy)}
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {strategies.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteSourceBranch}
              onChange={(e) => setDeleteSourceBranch(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            Delete source branch after merge
          </label>

          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 cursor-pointer">
            <input
              type="checkbox"
              checked={transitionWorkItems}
              onChange={(e) => setTransitionWorkItems(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
            Transition linked work items
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm({ mergeStrategy, deleteSourceBranch, transitionWorkItems })}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 dark:focus:ring-offset-gray-800"
          >
            Set Autocomplete
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
