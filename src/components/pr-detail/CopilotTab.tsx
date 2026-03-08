import { useState, useEffect, useMemo } from 'react';
import { useCopilotTerminal } from '../../hooks/useCopilotTerminal';
import type { PullRequest, PullRequestThread, IterationChange } from '../../types';
import { generateTextDiff } from '../../utils';
import { Spinner } from '../common';
import { useAuth } from '../../context';

interface CopilotTabProps {
  pr: PullRequest;
  threads: PullRequestThread[];
  changes: IterationChange[];
  fetchFilePair: (path: string, changeType?: string) => Promise<{ oldContent: string; newContent: string }>;
}

function branchName(ref: string) {
  return ref.replace(/^refs\/heads\//, '');
}

function buildPrContextString(
  pr: PullRequest,
  threads: PullRequestThread[],
  changes: IterationChange[],
  diffs: { path: string; diff: string }[],
): string {
  const lines: string[] = [
    'You are a helpful code review assistant for an Azure DevOps pull request.',
    '',
    '## PR Details',
    `- Title: ${pr.title}`,
  ];

  if (pr.description) {
    lines.push(`- Description: ${pr.description}`);
  }
  lines.push(
    `- Repository: ${pr.repository.name}`,
    `- Branch: ${branchName(pr.sourceRefName)} → ${branchName(pr.targetRefName)}`,
    `- Author: ${pr.createdBy.displayName}`,
    `- Status: ${pr.status}`,
  );

  if (pr.reviewers.length) {
    const revs = pr.reviewers
      .map((r) => `${r.displayName} (vote: ${r.vote})`)
      .join(', ');
    lines.push(`- Reviewers: ${revs}`);
  }

  if (changes.length) {
    lines.push('', '## Changed Files');
    for (const c of changes) {
      if (c.item?.path) lines.push(`- ${c.item.path} (${c.changeType})`);
    }
  }

  if (diffs.length) {
    lines.push('', '## File Diffs');
    let totalLen = 0;
    const MAX_DIFF_CHARS = 60_000;
    for (const d of diffs) {
      if (totalLen + d.diff.length > MAX_DIFF_CHARS) {
        lines.push('', '(remaining diffs truncated for size)');
        break;
      }
      lines.push('', '```diff', d.diff, '```');
      totalLen += d.diff.length;
    }
  }

  const activeThreads = threads
    .filter((t) => t.status === 'active' && t.comments.some((c) => c.commentType === 'text'));
  if (activeThreads.length) {
    lines.push('', '## Active Review Threads');
    for (const t of activeThreads) {
      const loc = t.threadContext?.filePath ? ` on ${t.threadContext.filePath}` : ' (general)';
      lines.push(`Thread${loc}:`);
      for (const c of t.comments) {
        if (c.commentType === 'text') {
          lines.push(`  - ${c.author.displayName}: ${c.content.slice(0, 300)}`);
        }
      }
    }
  }

  lines.push(
    '',
    'Use the above PR context to answer the user\'s questions. Wait for the user to ask before taking any action.',
  );

  return lines.join('\n');
}

export function CopilotTab({ pr, threads, changes, fetchFilePair }: CopilotTabProps) {
  const { config } = useAuth();
  const repoPath = config?.repoPath;
  const [diffs, setDiffs] = useState<{ path: string; diff: string }[]>([]);
  const [diffsReady, setDiffsReady] = useState(false);

  // Fetch file diffs for all changes before creating the session
  useEffect(() => {
    let cancelled = false;

    async function loadDiffs() {
      const filesToFetch = changes.filter((c) => c.item?.path);
      const results: { path: string; diff: string }[] = [];

      await Promise.all(
        filesToFetch.map(async (change) => {
          const path = change.item!.path;
          try {
            const { oldContent, newContent } = await fetchFilePair(path, change.changeType);
            const diff = generateTextDiff(oldContent, newContent, path);
            if (diff) results.push({ path, diff });
          } catch {
            // Skip files that fail to fetch
          }
        }),
      );

      if (!cancelled) {
        const pathOrder = filesToFetch.map((c) => c.item!.path);
        results.sort((a, b) => pathOrder.indexOf(a.path) - pathOrder.indexOf(b.path));
        setDiffs(results);
        setDiffsReady(true);
      }
    }

    loadDiffs();
    return () => { cancelled = true; };
  }, [changes, fetchFilePair]);

  const prContext = useMemo(
    () => buildPrContextString(pr, threads, changes, diffs),
    [pr, threads, changes, diffs],
  );

  const { terminalRef, connected, error, exited, reconnect } = useCopilotTerminal({
    prContext,
    repoPath,
    ready: diffsReady,
  });

  if (!diffsReady && !error) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-gray-500 dark:text-gray-400">
        <Spinner />
        <p className="mt-3 text-sm">Loading PR diffs for Copilot context…</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[600px]">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs">
        {repoPath && (
          <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded px-2.5 py-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            Local repo: {repoPath}
          </div>
        )}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border ${
          connected
            ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
            : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-700'
        }`}>
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
        {exited && (
          <button
            onClick={reconnect}
            className="px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Reconnect
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0"
        style={{ padding: '4px', background: '#1e1e2e' }}
      />
    </div>
  );
}
