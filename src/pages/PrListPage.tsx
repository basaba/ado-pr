import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePullRequests } from '../hooks';
import { Spinner, ErrorBanner, Badge } from '../components/common';
import { VOTE_LABELS, VOTE_COLORS } from '../types';
import { formatDate, branchName } from '../utils';
import { useAuth } from '../context';
import type { PrSearchFilters } from '../api/pullRequests';

type PresetFilter = 'assigned-to-me' | 'created-by-me' | 'all-active';
type DateRange = '30' | '60' | '90' | '180' | '365' | 'all';

function daysAgoISO(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export function PrListPage() {
  const { profile } = useAuth();
  const navigate = useNavigate();

  const [preset, setPreset] = useState<PresetFilter>('assigned-to-me');
  const [dateRange, setDateRange] = useState<DateRange>('30');

  const filters = useMemo<PrSearchFilters>(() => {
    const base: PrSearchFilters = (() => {
      switch (preset) {
        case 'assigned-to-me':
          return { reviewerId: profile?.id, status: 'active' };
        case 'created-by-me':
          return { creatorId: profile?.id, status: 'active' };
        case 'all-active':
          return { status: 'active' };
      }
    })();
    if (dateRange !== 'all') {
      base.minTime = daysAgoISO(Number(dateRange));
    }
    return base;
  }, [preset, profile?.id, dateRange]);

  const { pullRequests, loading, error, refresh } = usePullRequests(filters);

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
              onClick={() => setPreset(p.id)}
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
          {pullRequests.map((pr) => {
            const myReview = pr.reviewers.find((r) => r.id === profile?.id);
            const vote = myReview?.vote ?? 0;

            return (
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
