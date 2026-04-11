import { useState, useCallback } from 'react';
import { startMerge, getConflicts, resolveFile, completeMerge, abortMerge } from '../../api/merge';
import type { ConflictFile } from '../../api/merge';
import { Spinner, ErrorBanner, useToast } from '../common';
import { DiffViewer } from '../diff-viewer';
import { InteractiveConflictResolver } from './InteractiveConflictResolver';

type Phase = 'idle' | 'merging' | 'conflicts' | 'completing' | 'done';

interface Props {
  repoPath: string;
  sourceBranch: string;
  targetBranch: string;
  onRefreshPr?: () => void;
}

function branchName(ref: string) {
  return ref.replace(/^refs\/heads\//, '');
}

export function ConflictsTab({ repoPath, sourceBranch, targetBranch, onRefreshPr }: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [files, setFiles] = useState<ConflictFile[]>([]);
  const [resolvedPaths, setResolvedPaths] = useState<Set<string>>(new Set());
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editContent, setEditContent] = useState<string>('');
  const [editing, setEditing] = useState(false);
  const [interactiveMode, setInteractiveMode] = useState(false);
  const [resolving, setResolving] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [worktreePath, setWorktreePath] = useState<string | null>(null);
  const { showToast } = useToast();

  const source = branchName(sourceBranch);
  const target = branchName(targetBranch);

  const handleStart = useCallback(async () => {
    setPhase('merging');
    setError(null);
    try {
      const result = await startMerge(repoPath, sourceBranch, targetBranch);
      if (result.worktreePath) setWorktreePath(result.worktreePath);

      if (result.status === 'clean') {
        setPhase('done');
        showToast('Merge completed without conflicts!');
        return;
      }
      if (result.status === 'conflicts') {
        const conflictsData = await getConflicts(repoPath, result.worktreePath);
        setFiles(conflictsData.files);
        setResolvedPaths(new Set());
        setSelectedFile(conflictsData.files[0]?.path ?? null);
        setPhase('conflicts');
      } else {
        setError(result.message || 'Merge failed');
        setPhase('idle');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('idle');
    }
  }, [repoPath, sourceBranch, targetBranch, showToast]);

  const handleResolve = useCallback(async (path: string, resolution: 'ours' | 'theirs' | 'manual', content?: string) => {
    setResolving(path);
    try {
      await resolveFile(repoPath, path, resolution, content, worktreePath ?? undefined);
      setResolvedPaths((prev) => new Set(prev).add(path));
      setEditing(false);
      setInteractiveMode(false);
      showToast(`Resolved: ${path}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Resolve failed');
    } finally {
      setResolving(null);
    }
  }, [repoPath, worktreePath, showToast]);

  const handleComplete = useCallback(async () => {
    setPhase('completing');
    setError(null);
    try {
      await completeMerge(repoPath, commitMessage || undefined, worktreePath ?? undefined);
      setPhase('done');
      setWorktreePath(null);
      showToast('Merge committed and pushed!');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('conflicts');
    }
  }, [repoPath, commitMessage, worktreePath, showToast]);

  const handleAbort = useCallback(async () => {
    try {
      await abortMerge(repoPath, worktreePath ?? undefined);
      setPhase('idle');
      setFiles([]);
      setResolvedPaths(new Set());
      setSelectedFile(null);
      setError(null);
      setWorktreePath(null);
      showToast('Merge aborted.');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Abort failed');
    }
  }, [repoPath, worktreePath, showToast]);

  if (!repoPath) {
    return (
      <div className="p-6">
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
          <h3 className="text-sm font-medium text-yellow-800 dark:text-yellow-200">Local Repository Not Configured</h3>
          <p className="text-sm text-yellow-700 dark:text-yellow-300 mt-1">
            To resolve merge conflicts, configure a local repository path in the login settings.
          </p>
        </div>
      </div>
    );
  }

  // ── Phase: Idle ────────────────────────────────────────────────────
  if (phase === 'idle') {
    return (
      <div className="p-6">
        {error && <ErrorBanner message={error} />}
        <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6 text-center">
          <div className="text-4xl mb-3">⚠️</div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Merge Conflicts Detected</h3>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            This PR has conflicts between <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{source}</span> and <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{target}</span>.
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            Start a merge to fetch the latest changes and resolve conflicts locally.
          </p>
          <button
            onClick={handleStart}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800"
          >
            Start Merge
          </button>
        </div>
      </div>
    );
  }

  // ── Phase: Merging / Completing ────────────────────────────────────
  if (phase === 'merging' || phase === 'completing') {
    return (
      <div className="p-6 flex flex-col items-center justify-center py-20">
        <Spinner className="mb-4" />
        <p className="text-sm text-gray-500 dark:text-gray-400">
          {phase === 'merging' ? 'Fetching and merging branches…' : 'Committing and pushing…'}
        </p>
      </div>
    );
  }

  // ── Phase: Done ────────────────────────────────────────────────────
  if (phase === 'done') {
    return (
      <div className="p-6">
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-6 text-center">
          <div className="text-4xl mb-3">✅</div>
          <h3 className="text-lg font-semibold text-green-800 dark:text-green-200 mb-2">Merge Complete</h3>
          <p className="text-sm text-green-700 dark:text-green-300 mb-4">
            All conflicts have been resolved and pushed successfully.
          </p>
          {onRefreshPr && (
            <button
              onClick={onRefreshPr}
              className="px-4 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg border border-blue-200 dark:border-blue-800 transition-colors"
            >
              Refresh PR
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Phase: Conflicts ───────────────────────────────────────────────
  const allResolved = files.length > 0 && files.every((f) => resolvedPaths.has(f.path));
  const selected = files.find((f) => f.path === selectedFile);

  return (
    <div className="flex flex-col h-[calc(100vh-280px)] min-h-[500px]">
      {error && <div className="px-4 pt-2"><ErrorBanner message={error} /></div>}

      {/* Toolbar */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0">
        <span className="text-sm text-gray-600 dark:text-gray-300">
          <span className="font-medium">{resolvedPaths.size}</span> / {files.length} files resolved
        </span>
        <div className="flex-1" />
        {allResolved && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message (optional)"
              className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-72"
            />
            <button
              onClick={handleComplete}
              className="px-4 py-1.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-lg transition-colors"
            >
              Commit &amp; Push
            </button>
          </div>
        )}
        <button
          onClick={handleAbort}
          className="px-3 py-1.5 text-sm font-medium text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg border border-red-200 dark:border-red-800 transition-colors"
        >
          Abort Merge
        </button>
      </div>

      <div className="flex flex-1 min-h-0">
        {/* File list sidebar */}
        <div className="w-64 shrink-0 border-r border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 overflow-y-auto">
          <div className="px-3 py-2 text-xs font-semibold text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700 sticky top-0 bg-gray-50 dark:bg-gray-900">
            Conflicted Files
          </div>
          {files.map((file) => {
            const isResolved = resolvedPaths.has(file.path);
            const isSelected = selectedFile === file.path;
            return (
              <div
                key={file.path}
                onClick={() => {
                  setSelectedFile(file.path);
                  setEditing(false);
                  setInteractiveMode(false);
                }}
                className={`flex items-center gap-2 px-3 py-2 text-xs cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-900 dark:text-blue-200 font-medium'
                    : 'text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                <span className={`shrink-0 ${isResolved ? 'text-green-500' : 'text-red-500'}`}>
                  {isResolved ? '✓' : '✗'}
                </span>
                <span className="truncate">{file.path}</span>
              </div>
            );
          })}
        </div>

        {/* Diff / editor area */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selected ? (
            <>
              {/* File header with actions */}
              <div className="flex items-center gap-2 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
                <span className="font-mono text-sm text-gray-800 dark:text-gray-100 truncate flex-1">{selected.path}</span>
                {resolvedPaths.has(selected.path) ? (
                  <span className="text-xs font-medium text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded">
                    ✓ Resolved
                  </span>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => handleResolve(selected.path, 'ours')}
                      disabled={resolving === selected.path}
                      className="px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded border border-blue-200 dark:border-blue-800 disabled:opacity-50 transition-colors"
                    >
                      Accept Ours ({source})
                    </button>
                    <button
                      onClick={() => handleResolve(selected.path, 'theirs')}
                      disabled={resolving === selected.path}
                      className="px-2.5 py-1 text-xs font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-50 dark:hover:bg-purple-900/30 rounded border border-purple-200 dark:border-purple-800 disabled:opacity-50 transition-colors"
                    >
                      Accept Theirs ({target})
                    </button>
                    <button
                      onClick={() => {
                        setEditing(true);
                        setEditContent(selected.oursContent);
                      }}
                      disabled={resolving === selected.path}
                      className="px-2.5 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 transition-colors"
                    >
                      Edit Manually
                    </button>
                    <button
                      onClick={() => {
                        setEditing(false);
                        setInteractiveMode(true);
                      }}
                      disabled={resolving === selected.path}
                      className="px-2.5 py-1 text-xs font-medium text-teal-600 dark:text-teal-400 hover:bg-teal-50 dark:hover:bg-teal-900/30 rounded border border-teal-200 dark:border-teal-800 disabled:opacity-50 transition-colors"
                    >
                      Interactive Resolve
                    </button>
                  </div>
                )}
              </div>

              {/* Content area */}
              <div className="flex-1 min-h-0 overflow-auto">
                {interactiveMode ? (
                  <InteractiveConflictResolver
                    oursContent={selected.oursContent}
                    theirsContent={selected.theirsContent}
                    filePath={selected.path}
                    sourceBranch={source}
                    targetBranch={target}
                    onSave={(mergedContent) => handleResolve(selected.path, 'manual', mergedContent)}
                    onCancel={() => setInteractiveMode(false)}
                    saving={resolving === selected.path}
                  />
                ) : editing ? (
                  <div className="flex flex-col h-full">
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="flex-1 min-h-0 w-full p-4 font-mono text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 border-0 focus:outline-none resize-none"
                      spellCheck={false}
                    />
                    <div className="flex items-center gap-2 px-4 py-2 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 shrink-0">
                      <button
                        onClick={() => handleResolve(selected.path, 'manual', editContent)}
                        disabled={resolving === selected.path}
                        className="px-4 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors"
                      >
                        {resolving === selected.path ? 'Saving…' : 'Save Resolution'}
                      </button>
                      <button
                        onClick={() => setEditing(false)}
                        className="px-4 py-1.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                      <span className="text-blue-600 dark:text-blue-400 font-medium">Ours</span> ({source})
                      <span className="mx-2">vs</span>
                      <span className="text-purple-600 dark:text-purple-400 font-medium">Theirs</span> ({target})
                    </div>
                    <DiffViewer
                      oldContent={selected.oursContent}
                      newContent={selected.theirsContent}
                      filePath={selected.path}
                      threads={[]}
                      onAddComment={async () => {}}
                      onReply={async () => {}}
                      onSetStatus={async () => {}}
                      viewMode="split"
                    />
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-400 dark:text-gray-500 text-sm">
              Select a file to view conflicts
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
