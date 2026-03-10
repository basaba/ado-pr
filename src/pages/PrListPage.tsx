import { useState, useMemo, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePullRequests, useSearchParamState } from '../hooks';
import { Spinner, ErrorBanner, Badge, ReviewerVotes } from '../components/common';
import { AuthorListManager } from '../components/common/AuthorListManager';
import { formatDate, branchName, isTextComment } from '../utils';
import { useAuth } from '../context';
import type { PrSearchFilters } from '../api/pullRequests';
import { getRepositoryByName } from '../api/pullRequests';
import { listThreads } from '../api/threads';
import { loadLists } from '../components/common/authorListStore';

type PresetFilter = 'assigned-to-me' | 'created-by-me' | 'all-active';
type DateRange = '30' | '60' | '90' | '180' | '365' | 'all';

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

const REPO_STORAGE_KEY = 'pr-filter-repo';
const REPO_NAME_STORAGE_KEY = 'pr-filter-repo-name';
const PRESET_STORAGE_KEY = 'pr-filter-preset';
const DATE_RANGE_STORAGE_KEY = 'pr-filter-date-range';
const AUTHOR_LIST_STORAGE_KEY = 'pr-filter-author-list';
const TARGET_BRANCH_STORAGE_KEY = 'pr-filter-target-branch';

export function PrListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [presetParam, setPresetParamRaw] = useSearchParamState('preset', 'assigned-to-me');
  // Seed from localStorage on fresh navigation (no URL param present)
  const effectivePresetParam = presetParam === 'assigned-to-me' && !window.location.search.includes('preset')
    ? (localStorage.getItem(PRESET_STORAGE_KEY) ?? 'assigned-to-me')
    : presetParam;
  const preset: PresetFilter | null = effectivePresetParam === '' ? null : effectivePresetParam as PresetFilter;
  const setPresetParam = useCallback((v: string) => {
    setPresetParamRaw(v);
    localStorage.setItem(PRESET_STORAGE_KEY, v);
  }, [setPresetParamRaw]);
  const setPreset = (v: PresetFilter | null) => setPresetParam(v ?? '');

  const [selectedAuthorListParam, setSelectedAuthorListRaw] = useSearchParamState('authorList', '');
  const effectiveAuthorList = selectedAuthorListParam === '' && !window.location.search.includes('authorList')
    ? (localStorage.getItem(AUTHOR_LIST_STORAGE_KEY) ?? '')
    : selectedAuthorListParam;
  const selectedAuthorList = effectiveAuthorList;
  const setSelectedAuthorList = useCallback((v: string) => {
    setSelectedAuthorListRaw(v);
    localStorage.setItem(AUTHOR_LIST_STORAGE_KEY, v);
  }, [setSelectedAuthorListRaw]);
  const authorListActive = selectedAuthorList !== '';

  const [dateRangeParam, setDateRangeRaw] = useSearchParamState('dateRange', '30');
  const effectiveDateRange = (dateRangeParam === '30' && !window.location.search.includes('dateRange')
    ? (localStorage.getItem(DATE_RANGE_STORAGE_KEY) ?? '30')
    : dateRangeParam) as DateRange;
  const dateRange = effectiveDateRange;
  const setDateRange = useCallback((v: DateRange) => {
    setDateRangeRaw(v);
    localStorage.setItem(DATE_RANGE_STORAGE_KEY, v);
  }, [setDateRangeRaw]);

  const [repoId, setRepoId] = useState<string>(
    () => localStorage.getItem(REPO_STORAGE_KEY) ?? '',
  );
  const [repoName, setRepoName] = useState<string>(
    () => localStorage.getItem(REPO_NAME_STORAGE_KEY) ?? '',
  );
  const [repoLoading, setRepoLoading] = useState(false);
  const [repoError, setRepoError] = useState('');
  const [targetBranchParam, setTargetBranchParamRaw] = useSearchParamState('target', '');
  const effectiveTargetBranch = targetBranchParam || localStorage.getItem(TARGET_BRANCH_STORAGE_KEY) || '';
  const [targetBranchInput, setTargetBranchInput] = useState<string>(() => effectiveTargetBranch);
  useEffect(() => {
    setTargetBranchInput(targetBranchParam || localStorage.getItem(TARGET_BRANCH_STORAGE_KEY) || '');
  }, [targetBranchParam]);
  const targetBranch = effectiveTargetBranch;
  const commitTargetBranch = useCallback((value: string) => {
    setTargetBranchParamRaw(value);
    if (value) localStorage.setItem(TARGET_BRANCH_STORAGE_KEY, value);
    else localStorage.removeItem(TARGET_BRANCH_STORAGE_KEY);
  }, [setTargetBranchParamRaw]);

  const authors = useMemo(() => {
    if (!selectedAuthorList) return [];
    const lists = loadLists();
    return lists[selectedAuthorList] ?? [];
  }, [selectedAuthorList]);

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
    setSelectedAuthorList('');
  }, [setPreset, setSelectedAuthorList]);

  const handleAuthorListActiveChange = useCallback((active: boolean) => {
    if (active) setPreset(null);
    else {
      setPreset('assigned-to-me');
      setSelectedAuthorList('');
    }
  }, [setPreset, setSelectedAuthorList]);

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

  const [threadCounts, setThreadCounts] = useState<Record<string, number>>({});

  useEffect(() => {
    if (pullRequests.length === 0) return;
    setThreadCounts({});
    let cancelled = false;
    Promise.all(
      pullRequests.map(async (pr) => {
        try {
          const threads = await listThreads(pr.repository.id, pr.pullRequestId);
          const count = threads.reduce(
            (sum, t) => sum + t.comments.filter((c) => isTextComment(c.commentType)).length,
            0,
          );
          return [`${pr.repository.id}/${pr.pullRequestId}`, count] as const;
        } catch {
          return [`${pr.repository.id}/${pr.pullRequestId}`, -1] as const;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setThreadCounts(Object.fromEntries(results));
    });
    return () => { cancelled = true; };
  }, [pullRequests]);

  const presets: { id: PresetFilter; label: string }[] = [
    { id: 'assigned-to-me', label: '👤 Assigned to me' },
    { id: 'created-by-me', label: '✍️ Created by me' },
    { id: 'all-active', label: '📋 All active' },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800 dark:text-gray-100">Pull Requests</h1>
        <button onClick={refresh} className="text-sm text-blue-600 dark:text-blue-400 hover:underline">
          ↻ Refresh
        </button>
      </div>

      {/* Filter bar */}
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-4 mb-4 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => handlePresetClick(p.id)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                preset === p.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {p.label}
            </button>
          ))}
          <span className="mx-2 text-gray-300 dark:text-gray-600">|</span>
          <AuthorListManager
            selected={selectedAuthorList}
            onSelectedChange={setSelectedAuthorList}
            active={authorListActive}
            onActiveChange={handleAuthorListActiveChange}
          />
          <div className="ml-auto flex items-center gap-2">
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as DateRange)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-none cursor-pointer hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <option value="30">Last 30 days</option>
              <option value="60">Last 60 days</option>
              <option value="90">Last 90 days</option>
              <option value="180">Last 6 months</option>
              <option value="365">Last year</option>
              <option value="all">All time</option>
            </select>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500 dark:text-gray-400">Repo:</span>
              <input
                type="text"
                value={repoName}
                placeholder="Type repository name…"
                onChange={(e) => { setRepoName(e.target.value); if (!e.target.value) resolveRepo(''); }}
                onBlur={() => resolveRepo(repoName)}
                onKeyDown={handleRepoKeyDown}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 w-56"
                disabled={repoLoading}
              />
              {repoLoading && <span className="text-gray-400 dark:text-gray-500 text-xs animate-pulse">…</span>}
              {repoError && <span className="text-red-500 dark:text-red-400 text-xs">{repoError}</span>}
            </div>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500 dark:text-gray-400">Target:</span>
              <input
                type="text"
                value={targetBranchInput}
                placeholder="e.g. main"
                onChange={(e) => setTargetBranchInput(e.target.value)}
                onBlur={() => commitTargetBranch(targetBranchInput)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTargetBranch(targetBranchInput); }}
                className="px-3 py-1.5 rounded-lg text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-100 w-40"
              />
            </div>
          </div>
        </div>

      </div>

      {loading && <Spinner className="mt-10" />}
      {error && <ErrorBanner message={error} />}

      {!loading && !error && pullRequests.length === 0 && (
        <p className="text-gray-500 dark:text-gray-400 mt-10 text-center">
          No pull requests match the current filters.
        </p>
      )}

      {!loading && !error && pullRequests.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-lg shadow divide-y divide-gray-100 dark:divide-gray-700">
          {pullRequests.map((pr) => (
              <div
                key={pr.pullRequestId}
                className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer transition-colors"
                onClick={() => navigate(`/pr/${pr.repository.id}/${pr.pullRequestId}`)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{pr.title}</span>
                    {pr.isDraft && <Badge text="Draft" color="bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300" />}
                    {pr.autoCompleteSetBy?.id && <Badge text="Autocomplete" color="bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300" />}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 flex gap-3">
                    <span>{pr.repository.name}</span>
                    <span>{branchName(pr.sourceRefName)} → {branchName(pr.targetRefName)}</span>
                    <span>by {pr.createdBy.displayName}</span>
                    <span>{formatDate(pr.creationDate)}</span>
                  </div>
                </div>
                <div className="ml-4 shrink-0 flex items-center gap-3">
                  {(() => {
                    const count = threadCounts[`${pr.repository.id}/${pr.pullRequestId}`];
                    if (count == null) return null;
                    if (count < 0) return null;
                    return (
                      <span className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400" title={`${count} comment${count !== 1 ? 's' : ''}`}>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                          <path fillRule="evenodd" d="M2 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H8.5l-3.8 2.85A.75.75 0 0 1 3.5 16.25V14H4a2 2 0 0 1-2-2V5Zm4.5 2a.75.75 0 0 0 0 1.5h7a.75.75 0 0 0 0-1.5h-7Zm0 3a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5h-4Z" clipRule="evenodd" />
                        </svg>
                        {count}
                      </span>
                    );
                  })()}
                  <ReviewerVotes reviewers={pr.reviewers} currentUserId={profile?.id} />
                </div>
              </div>
          ))}
        </div>
      )}
    </div>
  );
}
