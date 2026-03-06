import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePullRequests } from '../hooks';
import { Spinner, ErrorBanner, Badge, ReviewerVotes } from '../components/common';
import { AuthorListManager } from '../components/common/AuthorListManager';
import { formatDate, branchName } from '../utils';
import { useAuth } from '../context';
import type { PrSearchFilters } from '../api/pullRequests';
import { getRepositoryByName } from '../api/pullRequests';

type PresetFilter = 'assigned-to-me' | 'created-by-me' | 'all-active';
type DateRange = '30' | '60' | '90' | '180' | '365' | 'all';

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const REPO_STORAGE_KEY = 'pr-filter-repo';
const REPO_NAME_STORAGE_KEY = 'pr-filter-repo-name';

export function PrListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [preset, setPreset] = useState<PresetFilter | null>('assigned-to-me');
  const [authorListActive, setAuthorListActive] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('30');
  const [repoId, setRepoId] = useState<string>(
    () => localStorage.getItem(REPO_STORAGE_KEY) ?? '',
  );
  const [repoName, setRepoName] = useState<string>(
    () => localStorage.getItem(REPO_NAME_STORAGE_KEY) ?? '',
  );
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [authors, setAuthors] = useState<{ id: string; displayName: string }[]>([]);
  const [targetBranch, setTargetBranch] = useState<string>(
    () => localStorage.getItem('pr-filter-target-branch') ?? '',
  );

  const resolveRepo = useCallback(async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) {
      setRepoId('');
      setRepoError('');
      localStorage.removeItem(REPO_STORAGE_KEY);
      localStorage.removeItem(REPO_NAME_STORAGE_KEY);
      return;
    }
    setRepoLoading(true);
    setRepoError('');
    try {
      const repo = await getRepositoryByName(trimmed);
      if (repo) {
        setRepoId(repo.id);
        setRepoName(repo.name);
        localStorage.setItem(REPO_STORAGE_KEY, repo.id);
        localStorage.setItem(REPO_NAME_STORAGE_KEY, repo.name);
      } else {
        setRepoId('');
        setRepoError('Repository not found');
        localStorage.removeItem(REPO_STORAGE_KEY);
        localStorage.removeItem(REPO_NAME_STORAGE_KEY);
      }
    } catch {
      setRepoError('Failed to look up repository');
    }
    setRepoLoading(false);
  }, []);

  const handleRepoKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter') resolveRepo(repoName);
    },
    [resolveRepo, repoName],
  );

  const handlePresetClick = useCallback((id: PresetFilter) => {
    setPreset(id);
    setAuthorListActive(false);
    setAuthors([]);
  }, []);

  const handleAuthorListActiveChange = useCallback((active: boolean) => {
    setAuthorListActive(active);
    if (active) setPreset(null);
    else setPreset('assigned-to-me');
  }, []);

  const filters = useMemo<PrSearchFilters>(() => {
    const base: PrSearchFilters = (() => {
      switch (preset) {
        case 'assigned-to-me':
          return { reviewerId: profile?.id, status: 'active' };
        case 'created-by-me':
          return { creatorId: profile?.id, status: 'active' };
        case 'all-active':
          return { status: 'active' };
        default:
          return { status: 'active' };
      }
    })();
    if (dateRange !== 'all') {
      base.minTime = daysAgoISO(Number(dateRange));
    }
    if (repoId) {
      base.repositoryId = repoId;
    }
    if (targetBranch) {
      base.targetRefName = `refs/heads/${targetBranch}`;
    }
    return base;
  }, [preset, profile?.id, dateRange, repoId, targetBranch]);

  const authorIds = useMemo(
    () => authors.length > 0 ? authors.map((a) => a.id) : undefined,
    [authors],
  );

  const { pullRequests, loading, error, refresh } = usePullRequests(filters, authorIds);

  const presets: { id: PresetFilter; label: string }[] = [
    { id: 'assigned-to-me', label: '👤 Assigned to me' },
    { id: 'created-by-me', label: '✍️ Created by me' },
    { id: 'all-active', label: '📋 All active' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">Pull Requests</h1>
        <button onClick={refresh} className="text-sm text-blue-600 hover:underline">
          ↻ Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white rounded-lg shadow p-4 mb-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePresetClick(p.id)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                preset === p.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {p.label}
            </button>
          ))}
          <span className="mx-2 text-gray-300">|</span>
          <AuthorListManager
            onChange={setAuthors}
            active={authorListActive}
            onActiveChange={handleAuthorListActiveChange}
          />
          <div className="ml-auto flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 text-gray-600 border-none cursor-pointer hover:bg-gray-200 transition-colors"
            >
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last year</option>
              <option value="all">All time</option>
            </select>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500">Repo:</span>
              <input
                type="text"
                value={repoName}
                placeholder="Type repository name…"
                onChange={(e) => { setRepoName(e.target.value); if (!e.target.value) resolveRepo(''); }}
                onBlur={() => resolveRepo(repoName)}
                onKeyDown={handleRepoKeyDown}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 bg-white text-gray-700 w-56"
                disabled={repoLoading}
              />
              {repoLoading && <span className="text-gray-400 text-xs animate-pulse">…</span>}
              {repoError && <span className="text-red-500 text-xs">{repoError}</span>}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500">Target:</span>
              <input
                type="text"
                value={targetBranch}
                placeholder="e.g. main"
                onChange={(e) => {
                  setTargetBranch(e.target.value);
                  if (!e.target.value) localStorage.removeItem('pr-filter-target-branch');
                }}
                onBlur={() => { if (targetBranch) localStorage.setItem('pr-filter-target-branch', targetBranch); }}
                onKeyDown={(e) => { if (e.key === 'Enter') localStorage.setItem('pr-filter-target-branch', targetBranch); }}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 bg-white text-gray-700 w-40"
              />
            </div>
          </div>
        </div>

      </div>

      {loading && <Spinner className="mt-10" />}
      {error && <ErrorBanner message={error} />}

      {!loading && !error && pullRequests.length === 0 && (
        <p className="text-gray-500 mt-10 text-center">
          No pull requests match the current filters.
        </p>
      )}

      {!loading && !error && pullRequests.length > 0 && (
        <div className="bg-white rounded-lg shadow divide-y divide-gray-100">
          {pullRequests.map((pr) => (
              <div
                key={pr.pullRequestId}
                className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 cursor-pointer transition-colors"
                onClick={() => navigate(`/pr/${pr.repository.id}/${pr.pullRequestId}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 truncate">{pr.title}</span>
                    {pr.isDraft && <Badge text="Draft" color="bg-gray-200 text-gray-600" />}
                  </div>
                  <div className="text-xs text-gray-500 mt-1 flex gap-3">
                    <span>{pr.repository.name}</span>
                    <span>{branchName(pr.sourceRefName)} → {branchName(pr.targetRefName)}</span>
                    <span>by {pr.createdBy.displayName}</span>
                    <span>{formatDate(pr.creationDate)}</span>
                  </div>
                </div>
                <div className="ml-4 shrink-0">
                  <ReviewerVotes reviewers={pr.reviewers} currentUserId={profile?.id} />
                </div>
              </div>
          ))}
        </div>
      )}
    </div>
  );
}
