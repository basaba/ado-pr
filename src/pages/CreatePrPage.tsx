import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, ErrorBanner, ErrorBoundary, Spinner } from '../components/common';
import {
  getRepositoryByName,
  listBranches,
  createPullRequest,
  searchUsers,
  resolveIdentityId,
} from '../api';
import type { GitRepository } from '../types';
import type { GitRef, UserSearchResult } from '../api/pullRequests';
import { BranchDiffPreview } from '../components/pr-detail/BranchDiffPreview';

const REPO_NAME_STORAGE_KEY = 'pr-filter-repo-name';

export function CreatePrPage() {
  const navigate = useNavigate();

  // Repo — pre-populated from current filter selection
  const [repoName, setRepoName] = useState(() => localStorage.getItem(REPO_NAME_STORAGE_KEY) ?? '');
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [selectedRepo, setSelectedRepo] = useState<GitRepository | null>(null);

  // Branches
  const [branches, setBranches] = useState<GitRef[]>([]);
  const [branchesLoading, setBranchesLoading] = useState(false);
  const [sourceBranch, setSourceBranch] = useState('');
  const [targetBranch, setTargetBranch] = useState('');
  const [sourceBranchQuery, setSourceBranchQuery] = useState('');
  const [targetBranchQuery, setTargetBranchQuery] = useState('');
  const [sourceBranchOpen, setSourceBranchOpen] = useState(false);
  const [targetBranchOpen, setTargetBranchOpen] = useState(false);

  // Form fields
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [workItemIds, setWorkItemIds] = useState('');

  // Reviewers
  const [reviewerQuery, setReviewerQuery] = useState('');
  const [reviewerResults, setReviewerResults] = useState<UserSearchResult[]>([]);
  const [reviewerLoading, setReviewerLoading] = useState(false);
  const [selectedReviewers, setSelectedReviewers] = useState<UserSearchResult[]>([]);
  const [reviewerDropdownOpen, setReviewerDropdownOpen] = useState(false);

  // Submit
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const resolveRepo = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setSelectedRepo(null);
      setRepoError('');
      setSourceBranch('');
      setTargetBranch('');
      setSourceBranchQuery('');
      setTargetBranchQuery('');
      return;
    }
    setRepoLoading(true);
    setRepoError('');
    try {
      const repo = await getRepositoryByName(trimmed);
      if (repo) {
        setSelectedRepo((prev) => {
          if (prev?.id !== repo.id) {
            setSourceBranch('');
            setTargetBranch('');
            setSourceBranchQuery('');
            setTargetBranchQuery('');
          }
          return repo;
        });
        setRepoName(repo.name);
      } else {
        setSelectedRepo(null);
        setRepoError('Repository not found');
      }
    } catch {
      setRepoError('Failed to look up repository');
    }
    setRepoLoading(false);
  }, []);

  // Resolve the pre-populated repo on mount
  useEffect(() => {
    if (repoName) resolveRepo(repoName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load branches when repo is selected
  useEffect(() => {
    if (!selectedRepo) { setBranches([]); return; }
    setBranchesLoading(true);
    listBranches(selectedRepo.id)
      .then(setBranches)
      .catch(() => setBranches([]))
      .finally(() => setBranchesLoading(false));
  }, [selectedRepo]);

  // Search reviewers
  useEffect(() => {
    if (reviewerQuery.length < 2) { setReviewerResults([]); return; }
    const timer = setTimeout(async () => {
      setReviewerLoading(true);
      try {
        const results = await searchUsers(reviewerQuery);
        setReviewerResults(results.filter(
          (r) => !selectedReviewers.some((s) => s.id === r.id),
        ));
      } catch { setReviewerResults([]); }
      setReviewerLoading(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [reviewerQuery, selectedReviewers]);

  const branchDisplayName = (ref: GitRef) =>
    ref.name.replace('refs/heads/', '');

  const filteredSourceBranches = branches.filter((b) =>
    branchDisplayName(b).toLowerCase().includes(sourceBranchQuery.toLowerCase()),
  );
  const filteredTargetBranches = branches.filter((b) =>
    branchDisplayName(b).toLowerCase().includes(targetBranchQuery.toLowerCase()),
  );

  const handleAddReviewer = useCallback((user: UserSearchResult) => {
    setSelectedReviewers((prev) => [...prev, user]);
    setReviewerQuery('');
    setReviewerDropdownOpen(false);
  }, []);

  const handleRemoveReviewer = useCallback((id: string) => {
    setSelectedReviewers((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const canSubmit =
    selectedRepo && sourceBranch && targetBranch && title.trim() && !submitting;

  const handleSubmit = async () => {
    if (!canSubmit || !selectedRepo) return;
    setSubmitting(true);
    setError(null);
    try {
      const workItemRefs = workItemIds
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((id) => ({ id }));

      const resolvedReviewers = await Promise.all(
        selectedReviewers
          .filter((r) => r.descriptor)
          .map(async (r) => ({ id: await resolveIdentityId(r.descriptor!) })),
      );

      const pr = await createPullRequest(selectedRepo.id, {
        sourceRefName: `refs/heads/${sourceBranch}`,
        targetRefName: `refs/heads/${targetBranch}`,
        title: title.trim(),
        description: description.trim() || undefined,
        reviewers: resolvedReviewers.length > 0 ? resolvedReviewers : undefined,
        isDraft,
        workItemRefs: workItemRefs.length > 0 ? workItemRefs : undefined,
      });
      navigate(`/pr/${selectedRepo.id}/${pr.pullRequestId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create pull request');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-6">Create Pull Request</h1>

      {error && <ErrorBanner message={error} />}

      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6 space-y-5">
        {/* Repository */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Repository *</label>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={repoName}
              placeholder="Type repository name…"
              onChange={(e) => {
                setRepoName(e.target.value);
                if (!e.target.value) { setSelectedRepo(null); setRepoError(''); }
              }}
              onBlur={() => resolveRepo(repoName)}
              onKeyDown={(e) => { if (e.key === 'Enter') resolveRepo(repoName); }}
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
              disabled={repoLoading}
            />
            {repoLoading && <span className="text-gray-400 dark:text-gray-500 text-xs animate-pulse">…</span>}
            {repoError && <span className="text-red-500 dark:text-red-400 text-xs">{repoError}</span>}
            {selectedRepo && !repoLoading && <span className="text-green-600 dark:text-green-400 text-xs">✓</span>}
          </div>
        </div>

        {/* Source branch */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Source Branch *</label>
          <div className="relative">
            <input
              type="text"
              value={sourceBranch || sourceBranchQuery}
              placeholder={selectedRepo ? 'Select source branch…' : 'Select a repository first'}
              disabled={!selectedRepo || branchesLoading}
              onChange={(e) => {
                setSourceBranchQuery(e.target.value);
                setSourceBranch('');
                setSourceBranchOpen(true);
              }}
              onFocus={() => setSourceBranchOpen(true)}
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            {branchesLoading && (
              <span className="absolute right-3 top-2.5 text-gray-400 dark:text-gray-500 text-xs animate-pulse">Loading…</span>
            )}
            {sourceBranchOpen && filteredSourceBranches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-sm">
                {filteredSourceBranches.slice(0, 50).map((b) => {
                  const name = branchDisplayName(b);
                  return (
                    <li
                      key={b.name}
                      onClick={() => {
                        setSourceBranch(name);
                        setSourceBranchQuery('');
                        setSourceBranchOpen(false);
                      }}
                      className={`px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 ${
                        sourceBranch === name ? 'bg-blue-100 dark:bg-blue-900 font-medium' : ''
                      }`}
                    >
                      {name}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Target branch */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Target Branch *</label>
          <div className="relative">
            <input
              type="text"
              value={targetBranch || targetBranchQuery}
              placeholder={selectedRepo ? 'Select target branch…' : 'Select a repository first'}
              disabled={!selectedRepo || branchesLoading}
              onChange={(e) => {
                setTargetBranchQuery(e.target.value);
                setTargetBranch('');
                setTargetBranchOpen(true);
              }}
              onFocus={() => setTargetBranchOpen(true)}
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 disabled:bg-gray-100 disabled:cursor-not-allowed"
            />
            {targetBranchOpen && filteredTargetBranches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-sm">
                {filteredTargetBranches.slice(0, 50).map((b) => {
                  const name = branchDisplayName(b);
                  return (
                    <li
                      key={b.name}
                      onClick={() => {
                        setTargetBranch(name);
                        setTargetBranchQuery('');
                        setTargetBranchOpen(false);
                      }}
                      className={`px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30 ${
                        targetBranch === name ? 'bg-blue-100 dark:bg-blue-900 font-medium' : ''
                      }`}
                    >
                      {name}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Title */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Title *</label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Pull request title"
            className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description (supports markdown)"
            rows={5}
            className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 resize-y"
          />
        </div>

        {/* Reviewers */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Reviewers</label>
          {selectedReviewers.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {selectedReviewers.map((r) => (
                <span
                  key={r.id}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs"
                >
                  {r.displayName}
                  <button
                    onClick={() => handleRemoveReviewer(r.id)}
                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 font-bold"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="relative">
            <input
              type="text"
              value={reviewerQuery}
              onChange={(e) => {
                setReviewerQuery(e.target.value);
                setReviewerDropdownOpen(true);
              }}
              onFocus={() => setReviewerDropdownOpen(true)}
              placeholder="Search users…"
              className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
            />
            {reviewerLoading && (
              <span className="absolute right-3 top-2.5 text-gray-400 dark:text-gray-500 text-xs animate-pulse">…</span>
            )}
            {reviewerDropdownOpen && reviewerResults.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full max-h-48 overflow-auto bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg text-sm">
                {reviewerResults.map((user) => (
                  <li
                    key={user.id}
                    onClick={() => handleAddReviewer(user)}
                    className="px-3 py-2 cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-900/30"
                  >
                    <div className="font-medium">{user.displayName}</div>
                    {user.mail && (
                      <div className="text-xs text-gray-400 dark:text-gray-500">{user.mail}</div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Draft toggle */}
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="isDraft"
            checked={isDraft}
            onChange={(e) => setIsDraft(e.target.checked)}
            className="rounded border-gray-300 dark:border-gray-600"
          />
          <label htmlFor="isDraft" className="text-sm text-gray-700 dark:text-gray-200">
            Create as draft
          </label>
        </div>

        {/* Work item IDs */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-1">Work Item IDs</label>
          <input
            type="text"
            value={workItemIds}
            onChange={(e) => setWorkItemIds(e.target.value)}
            placeholder="Comma-separated IDs, e.g. 123, 456"
            className="w-full px-3 py-2 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100"
          />
        </div>

        {/* Branch diff preview */}
        {selectedRepo && sourceBranch && targetBranch && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">Files Changed</label>
            <ErrorBoundary>
              <BranchDiffPreview
                repoId={selectedRepo.id}
                sourceBranch={sourceBranch}
                targetBranch={targetBranch}
              />
            </ErrorBoundary>
          </div>
        )}

        {/* Submit */}
        <div className="flex items-center gap-3 pt-2">
          <Button
            variant="primary"
            size="md"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? 'Creating…' : 'Create Pull Request'}
          </Button>
          <Button
            variant="ghost"
            size="md"
            onClick={() => navigate('/')}
            disabled={submitting}
          >
            Cancel
          </Button>
          {submitting && <Spinner className="ml-2" />}
        </div>
      </div>
    </div>
  );
}
