import { useState, useEffect, useCallback } from 'react';
import { getPolicyEvaluations, requeuePolicyEvaluation } from '../../api';
import { adoClient } from '../../api';
import type { PolicyEvaluation } from '../../types';
import { Spinner, ErrorBanner, useToast } from '../common';

const STATUS_ICON: Record<string, string> = {
  approved: '✅',
  rejected: '❌',
  running: '⏳',
  queued: '🕐',
  notApplicable: '⚪',
  broken: '⚠️',
};

const STATUS_LABEL: Record<string, string> = {
  approved: 'Passed',
  rejected: 'Failed',
  running: 'Running',
  queued: 'Queued',
  notApplicable: 'Not applicable',
  broken: 'Broken',
};

const STATUS_COLOR: Record<string, string> = {
  approved: 'text-green-600 dark:text-green-400',
  rejected: 'text-red-600 dark:text-red-400',
  running: 'text-blue-600 dark:text-blue-400',
  queued: 'text-gray-500 dark:text-gray-400',
  notApplicable: 'text-gray-400 dark:text-gray-500',
  broken: 'text-yellow-600 dark:text-yellow-400',
};

interface Props {
  prId: number;
}

export function PoliciesTab({ prId }: Props) {
  const [evaluations, setEvaluations] = useState<PolicyEvaluation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [requeueing, setRequeueing] = useState<Record<string, boolean>>({});
  const { showToast } = useToast();

  const sortEvals = (evals: PolicyEvaluation[]) => {
    const order: Record<string, number> = { rejected: 0, running: 1, queued: 2, broken: 3, approved: 4, notApplicable: 5 };
    return [...evals].sort((a, b) => {
      const blockDiff = (b.configuration.isBlocking ? 1 : 0) - (a.configuration.isBlocking ? 1 : 0);
      if (blockDiff !== 0) return blockDiff;
      return (order[a.status] ?? 9) - (order[b.status] ?? 9);
    });
  };

  useEffect(() => {
    const projectId = adoClient.projectId;
    if (!projectId) return;
    setLoading(true);
    getPolicyEvaluations(projectId, prId)
      .then((evals) => setEvaluations(sortEvals(evals)))
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [prId]);

  const handleRequeue = useCallback(async (evaluationId: string) => {
    setRequeueing((prev) => ({ ...prev, [evaluationId]: true }));
    try {
      const updated = await requeuePolicyEvaluation(evaluationId);
      setEvaluations((prev) =>
        sortEvals(prev.map((ev) => (ev.evaluationId === evaluationId ? updated : ev))),
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Requeue failed');
    } finally {
      setRequeueing((prev) => ({ ...prev, [evaluationId]: false }));
    }
  }, []);

  if (loading) return <Spinner className="mt-10" />;
  if (error) return <ErrorBanner message={error} />;
  if (evaluations.length === 0) {
    return <p className="text-sm text-gray-500 dark:text-gray-400">No policy evaluations found for this pull request.</p>;
  }

  const passed = evaluations.filter((e) => e.status === 'approved').length;
  const failed = evaluations.filter((e) => e.status === 'rejected').length;
  const running = evaluations.filter((e) => e.status === 'running' || e.status === 'queued').length;

  return (
    <div>
      {/* Summary bar */}
      <div className="flex gap-4 text-sm mb-4">
        <span className="text-green-600 dark:text-green-400 font-medium">{passed} passed</span>
        {failed > 0 && <span className="text-red-600 dark:text-red-400 font-medium">{failed} failed</span>}
        {running > 0 && <span className="text-blue-600 dark:text-blue-400 font-medium">{running} in progress</span>}
        <span className="text-gray-400 dark:text-gray-500">{evaluations.length} total</span>
      </div>

      {/* Policy list */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700 border border-gray-200 dark:border-gray-700 rounded-lg">
        {evaluations.map((ev) => (
          <div key={ev.evaluationId} className="flex items-center gap-3 px-4 py-3">
            <span className="text-lg" title={STATUS_LABEL[ev.status] ?? ev.status}>
              {STATUS_ICON[ev.status] ?? '❓'}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
                {ev.configuration.type.displayName}
                {ev.context?.buildDefinitionName && (
                  <span className="text-gray-500 dark:text-gray-400 font-normal ml-1">
                    — {ev.context.buildDefinitionName}
                  </span>
                )}
              </div>
              <div className="text-xs text-gray-500 dark:text-gray-400 flex gap-2">
                {ev.configuration.isBlocking && (
                  <span className="text-orange-600 dark:text-orange-400 font-medium">Required</span>
                )}
                {!ev.configuration.isBlocking && (
                  <span className="text-gray-400 dark:text-gray-500">Optional</span>
                )}
              </div>
            </div>
            <span className={`text-xs font-medium ${STATUS_COLOR[ev.status] ?? 'text-gray-500 dark:text-gray-400'}`}>
              {STATUS_LABEL[ev.status] ?? ev.status}
            </span>
            <button
              onClick={() => handleRequeue(ev.evaluationId)}
              disabled={requeueing[ev.evaluationId]}
              className="ml-1 px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded border border-blue-200 dark:border-blue-800 disabled:opacity-50 disabled:cursor-not-allowed"
              title="Requeue this policy evaluation"
            >
              {requeueing[ev.evaluationId] ? '...' : '↻ Requeue'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
