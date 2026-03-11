import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import {
  computeMergeHunks,
  buildMergedContent,
  allConflictsResolved,
  conflictProgress,
  type MergeHunk,
  type HunkSelection,
} from '../../utils/merge-hunks';

interface Props {
  oursContent: string;
  theirsContent: string;
  filePath: string;
  sourceBranch: string;
  targetBranch: string;
  onSave: (mergedContent: string) => void;
  onCancel: () => void;
  saving: boolean;
}

const COLLAPSED_CONTEXT_LINES = 4;
const MIN_PANE_HEIGHT = 80;

export function InteractiveConflictResolver({
  oursContent,
  theirsContent,
  filePath,
  sourceBranch,
  targetBranch,
  onSave,
  onCancel,
  saving,
}: Props) {
  const [selections, setSelections] = useState<HunkSelection>({});
  const [lastPickedHunkId, setLastPickedHunkId] = useState<number | null>(null);

  // Resizable pane: track preview height as a fraction (0..1)
  const [previewFraction, setPreviewFraction] = useState(0.35);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const hunkRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const previewHunkRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const previewScrollRef = useRef<HTMLDivElement>(null);

  const hunks = useMemo(
    () => computeMergeHunks(oursContent, theirsContent),
    [oursContent, theirsContent]
  );

  const progress = useMemo(() => conflictProgress(hunks, selections), [hunks, selections]);
  const isComplete = useMemo(() => allConflictsResolved(hunks, selections), [hunks, selections]);

  // Build per-hunk merged segments for rendering with markers
  const mergedSegments = useMemo(() => {
    const segments: { hunkId: number; type: 'unchanged' | 'conflict'; lines: string[]; selected: boolean }[] = [];
    for (const hunk of hunks) {
      if (hunk.type === 'unchanged') {
        segments.push({ hunkId: hunk.id, type: 'unchanged', lines: hunk.oursLines, selected: false });
      } else {
        const sel = selections[hunk.id];
        if (sel === 'ours') {
          segments.push({ hunkId: hunk.id, type: 'conflict', lines: hunk.oursLines, selected: true });
        } else if (sel === 'theirs') {
          segments.push({ hunkId: hunk.id, type: 'conflict', lines: hunk.theirsLines, selected: true });
        } else {
          segments.push({ hunkId: hunk.id, type: 'conflict', lines: [`<<<< unresolved conflict (hunk #${hunk.id + 1}) >>>>`], selected: false });
        }
      }
    }
    return segments;
  }, [hunks, selections]);

  // Full merged content for saving
  const mergedContent = useMemo(() => buildMergedContent(hunks, selections), [hunks, selections]);

  const selectHunk = useCallback((hunkId: number, side: 'ours' | 'theirs') => {
    setSelections((prev) => {
      if (prev[hunkId] === side) {
        const next = { ...prev };
        delete next[hunkId];
        setLastPickedHunkId(null);
        return next;
      }
      return { ...prev, [hunkId]: side };
    });
    setLastPickedHunkId(hunkId);
  }, []);

  // Scroll preview to the picked hunk and flash-highlight it
  useEffect(() => {
    if (lastPickedHunkId === null) return;
    const el = previewHunkRefs.current[lastPickedHunkId];
    if (!el) return;

    // Scroll into view within the preview scroll container
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Flash highlight
    el.classList.add('ring-2', 'ring-amber-400', 'dark:ring-amber-500', 'bg-amber-50/50', 'dark:bg-amber-900/20');
    const timer = setTimeout(() => {
      el.classList.remove('ring-2', 'ring-amber-400', 'dark:ring-amber-500', 'bg-amber-50/50', 'dark:bg-amber-900/20');
    }, 1500);
    return () => clearTimeout(timer);
  }, [lastPickedHunkId, selections]);

  // ── Drag-to-resize logic ───────────────────────────────────────────
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;

    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const totalHeight = rect.height;
      const mouseY = ev.clientY - rect.top;
      const pickerHeight = mouseY;
      const previewHeight = totalHeight - pickerHeight;
      // Clamp both panes to minimum height
      if (pickerHeight < MIN_PANE_HEIGHT || previewHeight < MIN_PANE_HEIGHT) return;
      setPreviewFraction(previewHeight / totalHeight);
    };

    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  // If there are no conflict hunks, the files are identical — auto-save ours
  useEffect(() => {
    if (progress.total === 0) {
      onSave(oursContent);
    }
  }, [progress.total, oursContent, onSave]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span className="font-mono text-sm text-gray-800 dark:text-gray-100 truncate">
          {filePath}
        </span>
        <span className="text-xs text-gray-500 dark:text-gray-400">—</span>
        <span className="text-xs font-medium text-amber-600 dark:text-amber-400">
          Interactive Mode
        </span>
        <div className="flex-1" />
        <span className="text-xs text-gray-500 dark:text-gray-400">
          <span className="font-semibold text-gray-700 dark:text-gray-200">{progress.resolved}</span>
          {' / '}
          {progress.total} hunks resolved
        </span>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => onSave(mergedContent)}
            disabled={!isComplete || saving}
            className="px-3 py-1 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded border border-green-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? 'Saving…' : 'Save Resolution'}
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="px-3 py-1 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded border border-gray-200 dark:border-gray-700 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-1.5 text-xs text-gray-500 dark:text-gray-400 bg-gray-50/50 dark:bg-gray-900/50 border-b border-gray-200 dark:border-gray-700 shrink-0">
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-100 dark:bg-blue-900 border border-blue-300 dark:border-blue-700 mr-1 align-middle" />
          Ours ({sourceBranch})
        </span>
        <span>
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-100 dark:bg-purple-900 border border-purple-300 dark:border-purple-700 mr-1 align-middle" />
          Theirs ({targetBranch})
        </span>
        <span className="text-gray-400 dark:text-gray-500">Click a side to pick it</span>
      </div>

      {/* Main content: Hunk picker on top, resizable Preview on bottom */}
      <div ref={containerRef} className="flex flex-col flex-1 min-h-0">
        {/* Top: Hunk picker */}
        <div className="min-h-0 overflow-auto" style={{ flex: `0 0 ${(1 - previewFraction) * 100}%` }}>
          <div className="divide-y divide-gray-200 dark:divide-gray-700">
            {hunks.map((hunk) =>
              hunk.type === 'unchanged' ? (
                <UnchangedHunk key={hunk.id} hunk={hunk} />
              ) : (
                <ConflictHunk
                  key={hunk.id}
                  hunk={hunk}
                  selection={selections[hunk.id] ?? null}
                  onSelect={selectHunk}
                  ref={(el) => { hunkRefs.current[hunk.id] = el; }}
                />
              )
            )}
          </div>
        </div>

        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          className="h-1.5 shrink-0 bg-gray-200 dark:bg-gray-700 hover:bg-blue-400 dark:hover:bg-blue-600 cursor-row-resize transition-colors flex items-center justify-center"
        >
          <div className="w-8 h-0.5 rounded bg-gray-400 dark:bg-gray-500" />
        </div>

        {/* Bottom: Live merged preview */}
        <div
          className="min-h-0 flex flex-col bg-white dark:bg-gray-800"
          style={{ flex: `0 0 ${previewFraction * 100}%` }}
        >
          <div className="px-3 py-1.5 text-xs font-semibold text-gray-500 dark:text-gray-400 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 shrink-0">
            Merged Preview
          </div>
          <div ref={previewScrollRef} className="flex-1 min-h-0 overflow-auto">
            <pre className="p-3 font-mono text-xs leading-5 text-gray-800 dark:text-gray-200 whitespace-pre-wrap break-words">
              {mergedSegments.map((seg) => (
                <div
                  key={seg.hunkId}
                  ref={(el) => { if (seg.type === 'conflict') previewHunkRefs.current[seg.hunkId] = el; }}
                  className={`transition-all duration-300 rounded-sm ${
                    seg.type === 'conflict' && !seg.selected
                      ? 'text-amber-600 dark:text-amber-400 italic'
                      : ''
                  }`}
                >
                  {seg.lines.map((line, i) => (
                    <div key={i} className="min-h-[20px]">{line}</div>
                  ))}
                </div>
              ))}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Unchanged Hunk ──────────────────────────────────────────────── */

function UnchangedHunk({ hunk }: { hunk: MergeHunk }) {
  const [expanded, setExpanded] = useState(false);
  const lines = hunk.oursLines;
  const isLarge = lines.length > COLLAPSED_CONTEXT_LINES * 2;

  const displayLines = expanded || !isLarge
    ? lines
    : [...lines.slice(0, COLLAPSED_CONTEXT_LINES), null, ...lines.slice(-COLLAPSED_CONTEXT_LINES)];

  return (
    <div className="bg-white dark:bg-gray-800">
      <pre className="font-mono text-xs leading-5 text-gray-500 dark:text-gray-400">
        {displayLines.map((line, i) =>
          line === null ? (
            <button
              key={`expand-${i}`}
              onClick={() => setExpanded(true)}
              className="block w-full text-center py-0.5 text-[10px] text-blue-500 hover:text-blue-700 dark:hover:text-blue-300 bg-gray-50 dark:bg-gray-900 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              ⊞ Show {lines.length - COLLAPSED_CONTEXT_LINES * 2} hidden lines
            </button>
          ) : (
            <div key={i} className="px-3 min-h-[20px]">
              {line}
            </div>
          )
        )}
      </pre>
    </div>
  );
}

/* ─── Conflict Hunk ───────────────────────────────────────────────── */

import { forwardRef } from 'react';

const ConflictHunk = forwardRef<
  HTMLDivElement,
  {
    hunk: MergeHunk;
    selection: 'ours' | 'theirs' | null;
    onSelect: (hunkId: number, side: 'ours' | 'theirs') => void;
  }
>(function ConflictHunk({ hunk, selection, onSelect }, ref) {
  const isOurs = selection === 'ours';
  const isTheirs = selection === 'theirs';
  const unresolved = selection === null;

  return (
    <div
      ref={ref}
      className={`border-l-[3px] ${
        unresolved
          ? 'border-l-amber-400 dark:border-l-amber-500 bg-amber-50/30 dark:bg-amber-900/10'
          : 'border-l-green-400 dark:border-l-green-500 bg-green-50/20 dark:bg-green-900/10'
      }`}
    >
      {/* Hunk header */}
      <div className="flex items-center gap-2 px-3 py-1 text-[10px] font-medium text-gray-500 dark:text-gray-400 bg-gray-50/80 dark:bg-gray-900/50">
        <span>
          {unresolved ? '◯' : '✓'} Conflict #{hunk.id + 1}
        </span>
        {selection && (
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
            isOurs
              ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
              : 'bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300'
          }`}>
            {isOurs ? 'Ours' : 'Theirs'}
          </span>
        )}
      </div>

      {/* Side-by-side content */}
      <div className="flex min-h-0">
        {/* Ours side */}
        <button
          type="button"
          onClick={() => onSelect(hunk.id, 'ours')}
          className={`flex-1 min-w-0 text-left transition-all cursor-pointer ${
            isOurs
              ? 'bg-blue-50 dark:bg-blue-900/30 ring-2 ring-inset ring-blue-400 dark:ring-blue-600'
              : unresolved
                ? 'bg-blue-50/40 dark:bg-blue-900/10 hover:bg-blue-50 dark:hover:bg-blue-900/20'
                : 'bg-gray-50 dark:bg-gray-800 opacity-40'
          }`}
        >
          <div className="px-2 py-0.5 text-[10px] font-semibold text-blue-600 dark:text-blue-400 border-b border-blue-200/50 dark:border-blue-800/50 flex items-center gap-1">
            {isOurs && <span>✓</span>}
            Ours
          </div>
          <pre className="font-mono text-xs leading-5 overflow-hidden">
            {hunk.oursLines.length > 0 ? (
              hunk.oursLines.map((line, i) => (
                <div key={i} className="px-2 min-h-[20px] text-red-800 dark:text-red-300">
                  <span className="select-none text-red-400 dark:text-red-600 mr-1">−</span>
                  {line}
                </div>
              ))
            ) : (
              <div className="px-2 py-1 text-gray-400 dark:text-gray-500 italic">
                (empty — lines removed)
              </div>
            )}
          </pre>
        </button>

        {/* Divider */}
        <div className="w-px bg-gray-300 dark:bg-gray-600 shrink-0" />

        {/* Theirs side */}
        <button
          type="button"
          onClick={() => onSelect(hunk.id, 'theirs')}
          className={`flex-1 min-w-0 text-left transition-all cursor-pointer ${
            isTheirs
              ? 'bg-purple-50 dark:bg-purple-900/30 ring-2 ring-inset ring-purple-400 dark:ring-purple-600'
              : unresolved
                ? 'bg-purple-50/40 dark:bg-purple-900/10 hover:bg-purple-50 dark:hover:bg-purple-900/20'
                : 'bg-gray-50 dark:bg-gray-800 opacity-40'
          }`}
        >
          <div className="px-2 py-0.5 text-[10px] font-semibold text-purple-600 dark:text-purple-400 border-b border-purple-200/50 dark:border-purple-800/50 flex items-center gap-1">
            {isTheirs && <span>✓</span>}
            Theirs
          </div>
          <pre className="font-mono text-xs leading-5 overflow-hidden">
            {hunk.theirsLines.length > 0 ? (
              hunk.theirsLines.map((line, i) => (
                <div key={i} className="px-2 min-h-[20px] text-green-800 dark:text-green-300">
                  <span className="select-none text-green-400 dark:text-green-600 mr-1">+</span>
                  {line}
                </div>
              ))
            ) : (
              <div className="px-2 py-1 text-gray-400 dark:text-gray-500 italic">
                (empty — lines added)
              </div>
            )}
          </pre>
        </button>
      </div>
    </div>
  );
});
