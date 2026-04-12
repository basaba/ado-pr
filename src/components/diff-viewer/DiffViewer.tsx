import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { histogramDiff } from 'histogram-diff';
import type { PullRequestThread, ThreadStatus } from '../../types';
import { formatDate, isTextComment, highlightLine } from '../../utils';
import { MarkdownContent, MentionTextarea, ConfirmDialog } from '../common';
import type { IdentitySearchResult } from '../../api/pullRequests';
import { useLocalStorageState } from '../../hooks';

interface Props {
  oldContent: string;
  newContent: string;
  filePath: string;
  threads: PullRequestThread[];
  onAddComment: (content: string, line: number) => Promise<void>;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  onToggleLike?: (threadId: number, commentId: number, currentUserId: string) => Promise<void>;
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  hiddenThreadIds?: Set<number>;
  onToggleHideThread?: (threadId: number) => void;
  scrollToLine?: number;
  onScrollHandled?: () => void;
  onMentionInserted?: (user: IdentitySearchResult) => void;
  viewMode?: DiffViewMode;
}

export type DiffViewMode = 'unified' | 'split' | 'original' | 'modified';

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
  /** Shared ID linking a moved-from block to its moved-to block */
  moveId?: number;
  /** Which side of a detected move this line belongs to */
  moveSide?: 'source' | 'destination';
}

/** Number of unchanged context lines to show around each change/comment */
const CONTEXT_LINES = 3;

export function computeDiffLines(oldText: string, newText: string, ignoreWhitespace = true): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // When ignoring whitespace, diff on trimmed lines then map back to originals.
  // This matches ADO's server-side diff behavior: re-indented moved code and
  // trailing whitespace changes are treated as unchanged.
  const diffOld = ignoreWhitespace ? oldLines.map(l => l.trim()) : oldLines;
  const diffNew = ignoreWhitespace ? newLines.map(l => l.trim()) : newLines;
  const regions = histogramDiff(diffOld, diffNew);
  const result: DiffLine[] = [];

  let oldIdx = 0;
  let newIdx = 0;

  for (const [aLo, aHi, bLo, bHi] of regions) {
    // Unchanged lines before this diff region (show new-file version for current indentation)
    while (oldIdx < aLo && newIdx < bLo) {
      result.push({ type: 'unchanged', oldLineNum: oldIdx + 1, newLineNum: newIdx + 1, content: newLines[newIdx] });
      oldIdx++;
      newIdx++;
    }
    // Removed lines (from old file)
    for (let i = aLo; i < aHi; i++) {
      result.push({ type: 'removed', oldLineNum: i + 1, newLineNum: null, content: oldLines[i] });
    }
    // Added lines (from new file)
    for (let i = bLo; i < bHi; i++) {
      result.push({ type: 'added', oldLineNum: null, newLineNum: i + 1, content: newLines[i] });
    }
    oldIdx = aHi;
    newIdx = bHi;
  }

  // Trailing unchanged lines
  while (oldIdx < oldLines.length && newIdx < newLines.length) {
    result.push({ type: 'unchanged', oldLineNum: oldIdx + 1, newLineNum: newIdx + 1, content: newLines[newIdx] });
    oldIdx++;
    newIdx++;
  }

  return result;
}

const MIN_MOVE_LINES = 3;

/**
 * Post-process diff lines to detect moved blocks.
 * Uses normalized (whitespace-trimmed) line matching similar to Git's --color-moved=blocks.
 * Only marks moves when normalized content is unique on each side, preventing false positives.
 */
export function detectMoves(lines: DiffLine[]): DiffLine[] {
  // Build normalized lookup: trimmedContent -> indices[] for removed and added
  const removedByNorm = new Map<string, number[]>();
  const addedByNorm = new Map<string, number[]>();

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const norm = l.content.trim();
    if (!norm) continue; // skip blank lines for matching
    if (l.type === 'removed') {
      const arr = removedByNorm.get(norm) || [];
      arr.push(i);
      removedByNorm.set(norm, arr);
    } else if (l.type === 'added') {
      const arr = addedByNorm.get(norm) || [];
      arr.push(i);
      addedByNorm.set(norm, arr);
    }
  }

  // For each removed line, find if its normalized content has a 1:1 match in added lines.
  // Build a per-line pairing: removedIdx -> addedIdx
  const removedToAdded = new Map<number, number>();
  const addedClaimed = new Set<number>();

  for (const [norm, removedIdxs] of removedByNorm) {
    const addedIdxs = addedByNorm.get(norm);
    if (!addedIdxs) continue;
    // Only pair if counts match (unique correspondence) or pair greedily
    // Greedy: pair in order, one-to-one
    let ai = 0;
    for (let ri = 0; ri < removedIdxs.length && ai < addedIdxs.length; ri++) {
      while (ai < addedIdxs.length && addedClaimed.has(addedIdxs[ai])) ai++;
      if (ai >= addedIdxs.length) break;
      removedToAdded.set(removedIdxs[ri], addedIdxs[ai]);
      addedClaimed.add(addedIdxs[ai]);
      ai++;
    }
  }

  // Group consecutive paired lines into move blocks
  // A move block: consecutive removed indices whose paired added indices are also consecutive
  const usedRemoved = new Set<number>();
  const moveBlocks: { removedStart: number; addedStart: number; length: number }[] = [];

  const removedIndices = [...removedToAdded.keys()].sort((a, b) => a - b);

  let i = 0;
  while (i < removedIndices.length) {
    if (usedRemoved.has(removedIndices[i])) { i++; continue; }
    const rStart = removedIndices[i];
    const aStart = removedToAdded.get(rStart)!;
    let len = 1;

    // Extend the block as long as consecutive removed lines pair to consecutive added lines
    while (
      i + len < removedIndices.length &&
      removedIndices[i + len] === rStart + len &&
      removedToAdded.get(removedIndices[i + len]) === aStart + len
    ) {
      len++;
    }

    if (len >= MIN_MOVE_LINES) {
      moveBlocks.push({ removedStart: rStart, addedStart: aStart, length: len });
      for (let j = 0; j < len; j++) usedRemoved.add(rStart + j);
    }
    i += len;
  }

  // Apply move metadata
  if (moveBlocks.length === 0) return lines;

  const result = lines.map(l => ({ ...l }));
  let moveId = 1;
  for (const block of moveBlocks) {
    for (let j = 0; j < block.length; j++) {
      result[block.removedStart + j].moveId = moveId;
      result[block.removedStart + j].moveSide = 'source';
      result[block.addedStart + j].moveId = moveId;
      result[block.addedStart + j].moveSide = 'destination';
    }
    moveId++;
  }

  return result;
}

export interface SplitPair {
  left: DiffLine | null;   // old/removed line (shown on left pane)
  right: DiffLine | null;  // new/added line (shown on right pane)
}

/** Pair diff lines for side-by-side rendering. Consecutive removed+added blocks are zipped. */
export function computeSplitPairs(diffLines: DiffLine[]): SplitPair[] {
  const pairs: SplitPair[] = [];
  let i = 0;

  while (i < diffLines.length) {
    const line = diffLines[i];

    if (line.type === 'unchanged') {
      pairs.push({ left: line, right: line });
      i++;
    } else {
      const removed: DiffLine[] = [];
      const added: DiffLine[] = [];

      while (i < diffLines.length && diffLines[i].type === 'removed') {
        removed.push(diffLines[i]);
        i++;
      }
      while (i < diffLines.length && diffLines[i].type === 'added') {
        added.push(diffLines[i]);
        i++;
      }

      const maxLen = Math.max(removed.length, added.length);
      for (let j = 0; j < maxLen; j++) {
        pairs.push({
          left: j < removed.length ? removed[j] : null,
          right: j < added.length ? added[j] : null,
        });
      }
    }
  }

  return pairs;
}

type HunkItem =
  | { kind: 'line'; idx: number }
  | { kind: 'collapsed'; fromIdx: number; toIdx: number; hiddenCount: number };

/** Build compact hunks: show changed lines, lines with threads, and CONTEXT_LINES of context. */
function buildHunks(diffLines: DiffLine[], threadLineSet: Set<number>): HunkItem[] {
  const visible = new Array(diffLines.length).fill(false);

  for (let i = 0; i < diffLines.length; i++) {
    const line = diffLines[i];
    const isChange = line.type !== 'unchanged';
    const hasThread = line.newLineNum != null && threadLineSet.has(line.newLineNum);

    if (isChange || hasThread) {
      for (let c = Math.max(0, i - CONTEXT_LINES); c <= Math.min(diffLines.length - 1, i + CONTEXT_LINES); c++) {
        visible[c] = true;
      }
    }
  }

  const items: HunkItem[] = [];
  let idx = 0;
  while (idx < diffLines.length) {
    if (visible[idx]) {
      items.push({ kind: 'line', idx });
      idx++;
    } else {
      const fromIdx = idx;
      while (idx < diffLines.length && !visible[idx]) idx++;
      items.push({ kind: 'collapsed', fromIdx, toIdx: idx - 1, hiddenCount: idx - fromIdx });
    }
  }
  return items;
}

/** Build compact hunks for split-pair view. */
function buildSplitHunks(pairs: SplitPair[], threadLineSet: Set<number>): HunkItem[] {
  const visible = new Array(pairs.length).fill(false);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const isChange = !pair.left || !pair.right || pair.left.type !== 'unchanged' || pair.right.type !== 'unchanged';
    const hasThread = pair.right?.newLineNum != null && threadLineSet.has(pair.right.newLineNum);

    if (isChange || hasThread) {
      for (let c = Math.max(0, i - CONTEXT_LINES); c <= Math.min(pairs.length - 1, i + CONTEXT_LINES); c++) {
        visible[c] = true;
      }
    }
  }

  const items: HunkItem[] = [];
  let idx = 0;
  while (idx < pairs.length) {
    if (visible[idx]) {
      items.push({ kind: 'line', idx });
      idx++;
    } else {
      const fromIdx = idx;
      while (idx < pairs.length && !visible[idx]) idx++;
      items.push({ kind: 'collapsed', fromIdx, toIdx: idx - 1, hiddenCount: idx - fromIdx });
    }
  }
  return items;
}

export function DiffViewer({
  oldContent,
  newContent,
  filePath,
  threads,
  onAddComment,
  onReply,
  onSetStatus,
  onDeleteComment,
  onToggleLike,
  usersMap,
  currentUserId,
  isPrOwner,
  hiddenThreadIds,
  onToggleHideThread,
  scrollToLine,
  onScrollHandled,
  onMentionInserted,
  viewMode = 'unified',
}: Props) {
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [autoExpandLine, setAutoExpandLine] = useState<number | null>(null);
  const [expanded, setExpandedRaw] = useLocalStorageState<'true' | 'false'>('ado-pr-diff-expanded', 'false');
  const isExpanded = expanded === 'true';
  const setExpanded = useCallback((v: boolean) => setExpandedRaw(v ? 'true' : 'false'), [setExpandedRaw]);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [splitRatio, setSplitRatio] = useLocalStorageState<string>('ado-pr-diff-split-ratio', '0.5');
  const isDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const leftPaneRef = useRef<HTMLDivElement>(null);
  const rightPaneRef = useRef<HTMLDivElement>(null);
  const [showGoToLine, setShowGoToLine] = useState(false);
  const [goToLineInput, setGoToLineInput] = useState('');
  const goToLineRef = useRef<HTMLInputElement>(null);

  // Reset per-section expansions when view mode changes (hunk indices differ between unified and split)
  useEffect(() => {
    setExpandedSections(new Set());
  }, [viewMode]);

  const updateWidth = useCallback(() => {
    if (scrollContainerRef.current) {
      setContainerWidth(scrollContainerRef.current.clientWidth);
    }
  }, []);

  useEffect(() => {
    updateWidth();
    const ro = new ResizeObserver(updateWidth);
    if (scrollContainerRef.current) ro.observe(scrollContainerRef.current);
    return () => ro.disconnect();
  }, [updateWidth]);

  // Width for comment/thread overlays: container width minus gutter columns (~6rem)
  const commentBoxWidth = containerWidth > 0 ? `${containerWidth - 10}px` : '100%';

  // Draggable separator for split view
  const handleSeparatorMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const container = splitContainerRef.current;
    if (!container) return;
    const startX = e.clientX;
    const containerRect = container.getBoundingClientRect();
    const startRatio = parseFloat(splitRatio);

    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      const dx = ev.clientX - startX;
      const newRatio = Math.min(0.8, Math.max(0.2, startRatio + dx / containerRect.width));
      setSplitRatio(String(newRatio));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [splitRatio, setSplitRatio]);

  // Synchronized vertical scrolling between split panes
  const syncingScroll = useRef(false);
  const handleSplitScroll = useCallback((source: 'left' | 'right') => {
    if (syncingScroll.current) return;
    syncingScroll.current = true;
    const src = source === 'left' ? leftPaneRef.current : rightPaneRef.current;
    const dst = source === 'left' ? rightPaneRef.current : leftPaneRef.current;
    if (src && dst) {
      dst.scrollTop = src.scrollTop;
    }
    requestAnimationFrame(() => { syncingScroll.current = false; });
  }, []);

  const diffLines = useMemo(() => detectMoves(computeDiffLines(oldContent, newContent)), [oldContent, newContent]);

  const knownUsers: IdentitySearchResult[] = useMemo(
    () => usersMap ? Object.entries(usersMap).map(([id, displayName]) => ({ id, displayName })) : [],
    [usersMap],
  );

  // Index threads by line number
  const threadsByLine: Record<number, PullRequestThread[]> = {};
  const threadLineSet = new Set<number>();
  threads.forEach((t) => {
    const line = t.threadContext?.rightFileStart?.line;
    if (line) {
      if (!threadsByLine[line]) threadsByLine[line] = [];
      threadsByLine[line].push(t);
      threadLineSet.add(line);
    }
  });

  const hunks = useMemo(
    () => buildHunks(diffLines, threadLineSet),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [diffLines, threads],
  );

  const splitPairs = useMemo(
    () => viewMode === 'split' ? computeSplitPairs(diffLines) : [],
    [diffLines, viewMode],
  );

  const splitHunks = useMemo(
    () => viewMode === 'split' ? buildSplitHunks(splitPairs, threadLineSet) : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [splitPairs, threads, viewMode],
  );

  const activeHunks = viewMode === 'split' ? splitHunks : hunks;
  const hasCollapsed = activeHunks.some((h) => h.kind === 'collapsed');

  // Scroll to a specific line when requested
  useEffect(() => {
    if (scrollToLine == null) return;
    // Small delay to let DOM render
    const timer = setTimeout(() => {
      const el = scrollContainerRef.current?.querySelector(`[data-line="${scrollToLine}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('bg-yellow-200', 'dark:bg-yellow-800/40');
        setTimeout(() => el.classList.remove('bg-yellow-200', 'dark:bg-yellow-800/40'), 2000);
      }
      onScrollHandled?.();
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToLine, onScrollHandled]);

  // Scroll to the first diff when switching to full-file view
  useEffect(() => {
    if (!isExpanded) return;
    // Find the first changed line that has a newLineNum (used as data-line attribute).
    // For pure deletions the first removed line's neighbors will have newLineNum set,
    // so look for the nearest line with newLineNum around the first change.
    const firstChangedIdx = diffLines.findIndex((l) => l.type !== 'unchanged');
    if (firstChangedIdx === -1) return;
    let targetLine: number | null = null;
    // Search forward from the first change for a line with newLineNum
    for (let i = firstChangedIdx; i < diffLines.length && targetLine == null; i++) {
      if (diffLines[i].newLineNum != null) targetLine = diffLines[i].newLineNum;
    }
    // Fallback: search backward
    if (targetLine == null) {
      for (let i = firstChangedIdx - 1; i >= 0 && targetLine == null; i--) {
        if (diffLines[i].newLineNum != null) targetLine = diffLines[i].newLineNum;
      }
    }
    if (targetLine == null) return;
    const timer = setTimeout(() => {
      const el = scrollContainerRef.current?.querySelector(`[data-line="${targetLine}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
      }
    }, 50);
    return () => clearTimeout(timer);
    // Only trigger when isExpanded changes to true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  // Go-to-line: navigate to a specific line number
  const goToLine = useCallback((lineNum: number) => {
    // Expand full file so the target line is in the DOM
    if (!isExpanded) {
      setExpanded(true);
      setExpandedSections(new Set());
    }
    // Delay to let the DOM render after expansion
    setTimeout(() => {
      const el = scrollContainerRef.current?.querySelector(`[data-line="${lineNum}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'instant', block: 'center' });
        el.classList.add('bg-yellow-200', 'dark:bg-yellow-800/40');
        setTimeout(() => el.classList.remove('bg-yellow-200', 'dark:bg-yellow-800/40'), 2000);
      }
    }, 60);
  }, [isExpanded, setExpanded]);

  const handleGoToLineSubmit = useCallback(() => {
    const num = parseInt(goToLineInput, 10);
    if (!isNaN(num) && num > 0) {
      goToLine(num);
    }
    setShowGoToLine(false);
    setGoToLineInput('');
  }, [goToLineInput, goToLine]);

  // Ctrl+G / Cmd+G keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
        // Only handle if focus is within this diff viewer or no specific input is focused
        const container = scrollContainerRef.current;
        if (!container) return;
        const active = document.activeElement;
        const isInThisDiff = container.contains(active) || active === document.body;
        if (!isInThisDiff) return;
        e.preventDefault();
        setShowGoToLine((prev) => !prev);
        setGoToLineInput('');
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, []);

  // Auto-focus the go-to-line input when shown
  useEffect(() => {
    if (showGoToLine) goToLineRef.current?.focus();
  }, [showGoToLine]);

  const handleSubmitComment = async () => {
    if (!commentText.trim() || commentLine == null) return;
    const postedLine = commentLine;
    setSending(true);
    try {
      await onAddComment(commentText, commentLine);
      setCommentText('');
      setCommentLine(null);
      setAutoExpandLine(postedLine);
    } finally {
      setSending(false);
    }
  };

  const lineColors: Record<string, string> = {
    added: 'bg-green-50 dark:bg-green-900/20', removed: 'bg-red-50 dark:bg-red-900/20', unchanged: '',
  };
  const lineTextColors: Record<string, string> = {
    added: 'text-green-800 dark:text-green-400', removed: 'text-red-800 dark:text-red-400', unchanged: 'text-gray-700 dark:text-gray-200',
  };
  const gutterColors: Record<string, string> = {
    added: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400', removed: 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-400', unchanged: 'bg-gray-50 dark:bg-gray-900 text-gray-400 dark:text-gray-500',
  };
  // Move-specific color overrides (blue/purple tones)
  const moveLineColors: Record<string, string> = {
    removed: 'bg-blue-50 dark:bg-blue-900/20', added: 'bg-blue-50 dark:bg-purple-900/20',
  };
  const moveLineTextColors: Record<string, string> = {
    removed: 'text-blue-600 dark:text-blue-400', added: 'text-purple-700 dark:text-purple-400',
  };
  const moveGutterColors: Record<string, string> = {
    removed: 'bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400', added: 'bg-purple-100 dark:bg-purple-900/40 text-purple-600 dark:text-purple-400',
  };

  // Threads not matched to any diff line
  const matchedLineSet = new Set<number>();
  diffLines.forEach((l) => { if (l.newLineNum) matchedLineSet.add(l.newLineNum); });
  const unmatchedThreads = threads.filter((t) => {
    const line = t.threadContext?.rightFileStart?.line;
    return !line || !matchedLineSet.has(line);
  });

  // Syntax-highlighted content renderer
  const renderHighlighted = useCallback((content: string) => {
    const html = highlightLine(content, filePath);
    if (html == null) return content;
    return <span dangerouslySetInnerHTML={{ __html: html }} />;
  }, [filePath]);

  const renderDiffLine = (idx: number) => {
    const line = diffLines[idx];
    const newLineNum = line.newLineNum;
    const lineThreads = newLineNum ? threadsByLine[newLineNum] || [] : [];

    return (
      <DiffLineRow
        key={idx}
        line={line}
        lineColors={lineColors}
        lineTextColors={lineTextColors}
        gutterColors={gutterColors}
        moveLineColors={moveLineColors}
        moveLineTextColors={moveLineTextColors}
        moveGutterColors={moveGutterColors}
        lineThreads={lineThreads}
        isCommentOpen={commentLine != null && commentLine === newLineNum}
        onGutterClick={() => {
          if (newLineNum) {
            setCommentLine(commentLine === newLineNum ? null : newLineNum);
            setCommentText('');
          }
        }}
        commentText={commentText}
        onCommentTextChange={setCommentText}
        sending={sending}
        onSubmitComment={handleSubmitComment}
        onCancelComment={() => { setCommentLine(null); setCommentText(''); }}
        onReply={onReply}
        onSetStatus={onSetStatus}
        onDeleteComment={onDeleteComment}
        onToggleLike={onToggleLike}
        usersMap={usersMap}
        currentUserId={currentUserId}
        isPrOwner={isPrOwner}
        hiddenThreadIds={hiddenThreadIds}
        onToggleHideThread={onToggleHideThread}
        knownUsers={knownUsers}
        onMentionInserted={onMentionInserted}
        autoExpand={autoExpandLine != null && autoExpandLine === newLineNum}
        onAutoExpandHandled={() => setAutoExpandLine(null)}
        renderHighlighted={renderHighlighted}
      />
    );
  };

  const renderSplitLeftLine = (idx: number) => {
    const pair = splitPairs[idx];
    const leftType = pair.left?.type ?? 'unchanged';
    const leftEmpty = !pair.left;
    const leftMoved = pair.left?.moveId != null;
    const emptyBg = 'bg-gray-100 dark:bg-gray-800';
    const leftPrefix = leftMoved ? (pair.left?.moveSide === 'source' ? '↰' : '↳') : pair.left?.type === 'removed' ? '-' : ' ';
    const leftGutter = leftEmpty ? emptyBg : leftMoved ? (moveGutterColors[leftType] ?? gutterColors[leftType]) : gutterColors[leftType];
    const leftBg = leftEmpty ? emptyBg : leftMoved ? (moveLineColors[leftType] ?? lineColors[leftType]) : lineColors[leftType];
    const leftText = leftMoved ? (moveLineTextColors[leftType] ?? lineTextColors[leftType]) : lineTextColors[leftType];

    return (
      <tr key={idx} className="hover:brightness-95">
        <td className={`text-right px-2 py-0 select-none ${leftGutter}`}>{pair.left?.oldLineNum ?? ''}</td>
        <td className={`px-3 py-0 whitespace-pre ${leftBg} ${leftText}`} title={leftMoved ? `Moved code (block ${pair.left?.moveId})` : undefined}>
          {pair.left && (
            <>
              <span className="select-none opacity-50 mr-1">{leftPrefix}</span>
              {renderHighlighted(pair.left.content)}
            </>
          )}
        </td>
      </tr>
    );
  };

  const renderSplitRightLine = (idx: number) => {
    const pair = splitPairs[idx];
    const newLineNum = pair.right?.newLineNum ?? null;
    const lineThreads = newLineNum ? threadsByLine[newLineNum] || [] : [];
    const rightType = pair.right?.type ?? 'unchanged';
    const rightEmpty = !pair.right;
    const rightMoved = pair.right?.moveId != null;
    const emptyBg = 'bg-gray-100 dark:bg-gray-800';
    const rightPrefix = rightMoved ? (pair.right?.moveSide === 'source' ? '↰' : '↳') : pair.right?.type === 'added' ? '+' : ' ';
    const rightGutter = rightEmpty ? emptyBg : rightMoved ? (moveGutterColors[rightType] ?? gutterColors[rightType]) : gutterColors[rightType];
    const rightBg = rightEmpty ? emptyBg : rightMoved ? (moveLineColors[rightType] ?? lineColors[rightType]) : lineColors[rightType];
    const rightText = rightMoved ? (moveLineTextColors[rightType] ?? lineTextColors[rightType]) : lineTextColors[rightType];

    return (
      <tr key={idx} className="hover:brightness-95" data-line={pair.right?.newLineNum ?? undefined}>
        <td className={`text-right px-2 py-0 select-none ${rightGutter}`}>{pair.right?.newLineNum ?? ''}</td>
        <td
          className={`text-center px-1 py-0 select-none ${rightGutter} ${lineThreads.length > 0 || rightEmpty ? '' : 'cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900'}`}
          onClick={lineThreads.length > 0 || rightEmpty ? undefined : () => {
            if (newLineNum) {
              setCommentLine(commentLine === newLineNum ? null : newLineNum);
              setCommentText('');
            }
          }}
          title={lineThreads.length > 0 || rightEmpty ? undefined : 'Add comment'}
        >
          {lineThreads.length > 0 ? (
            <CommentIndicator
              lineThreads={lineThreads}
              onReply={onReply}
              onSetStatus={onSetStatus}
              onDeleteComment={onDeleteComment}
              onToggleLike={onToggleLike}
              usersMap={usersMap}
              currentUserId={currentUserId}
              isPrOwner={isPrOwner}
              hiddenThreadIds={hiddenThreadIds}
              onToggleHideThread={onToggleHideThread}
              knownUsers={knownUsers}
              onMentionInserted={onMentionInserted}
              autoExpand={autoExpandLine != null && autoExpandLine === newLineNum}
              onAutoExpandHandled={() => setAutoExpandLine(null)}
            />
          ) : (
            pair.right?.newLineNum ? (
              <AddCommentPopover
                isOpen={commentLine != null && commentLine === newLineNum}
                onGutterClick={() => {
                  if (newLineNum) {
                    setCommentLine(commentLine === newLineNum ? null : newLineNum);
                    setCommentText('');
                  }
                }}
                commentText={commentText}
                onCommentTextChange={setCommentText}
                sending={sending}
                onSubmitComment={handleSubmitComment}
                onCancelComment={() => { setCommentLine(null); setCommentText(''); }}
                knownUsers={knownUsers}
                onMentionInserted={onMentionInserted}
              />
            ) : ''
          )}
        </td>
        <td className={`px-3 py-0 whitespace-pre ${rightBg} ${rightText}`} title={rightMoved ? `Moved code (block ${pair.right?.moveId})` : undefined}>
          {pair.right && (
            <>
              <span className="select-none opacity-50 mr-1">{rightPrefix}</span>
              {renderHighlighted(pair.right.content)}
            </>
          )}
        </td>
      </tr>
    );
  };

  const renderHunks = (items: HunkItem[], renderLine: (idx: number) => React.ReactNode, colSpan: number) => {
    return isExpanded
      ? (viewMode === 'split' ? splitPairs : diffLines).map((_, idx) => renderLine(idx))
      : items.map((item, hunkIdx) => {
          if (item.kind === 'line') return renderLine(item.idx);
          if (expandedSections.has(hunkIdx)) {
            const lines = [];
            for (let i = item.fromIdx; i <= item.toIdx; i++) {
              lines.push(renderLine(i));
            }
            return lines;
          }
          return (
            <tr key={`sep-${hunkIdx}`} className="select-none cursor-pointer group" onClick={() => setExpandedSections((prev) => new Set(prev).add(hunkIdx))}>
              <td colSpan={colSpan} className="bg-blue-50 dark:bg-blue-900/30 group-hover:bg-blue-100 dark:group-hover:bg-blue-900 text-center text-blue-400 text-lg px-1 py-1">↕</td>
            </tr>
          );
        });
  };

  return (
    <div className="text-xs font-mono relative" ref={scrollContainerRef}>
      <div className="min-w-0 overflow-x-auto">
        {hasCollapsed && (
          <div className="flex justify-end gap-3 items-center px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 font-sans">
            <button
              onClick={() => { setShowGoToLine((v) => !v); setGoToLineInput(''); }}
              className="text-xs text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline"
              title="Go to line (Ctrl+G)"
            >
              Go to Line
            </button>
            <button
              onClick={() => { setExpanded(!isExpanded); setExpandedSections(new Set()); }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {isExpanded ? '⊟ Compact diff' : '⊞ Show full file'}
            </button>
          </div>
        )}

        {showGoToLine && createPortal(
          <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => { setShowGoToLine(false); setGoToLineInput(''); }}>
            <div
              className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl border border-gray-200 dark:border-gray-600 p-4 w-72 font-sans"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Go to Line</span>
                <button
                  onClick={() => { setShowGoToLine(false); setGoToLineInput(''); }}
                  className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none"
                >
                  ✕
                </button>
              </div>
              <div className="flex items-center gap-2">
                <input
                  ref={goToLineRef}
                  type="number"
                  min={1}
                  value={goToLineInput}
                  onChange={(e) => setGoToLineInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleGoToLineSubmit();
                    if (e.key === 'Escape') { setShowGoToLine(false); setGoToLineInput(''); }
                  }}
                  className="flex-1 px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-gray-900 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter line number"
                />
                <button
                  onClick={handleGoToLineSubmit}
                  className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700 whitespace-nowrap"
                >
                  Go
                </button>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Press Enter to go, Escape to close</p>
            </div>
          </div>,
          document.body,
        )}

        {viewMode === 'original' || viewMode === 'modified' ? (() => {
          // Build set of changed line numbers from diff data
          const changedLines = new Set<number>();
          for (const dl of diffLines) {
            if (viewMode === 'original' && dl.type === 'removed' && dl.oldLineNum) changedLines.add(dl.oldLineNum);
            if (viewMode === 'modified' && dl.type === 'added' && dl.newLineNum) changedLines.add(dl.newLineNum);
          }
          const lines = (viewMode === 'original' ? oldContent : newContent).split('\n');
          return (
            <div className="overflow-x-auto">
              <table className="border-collapse" style={{ minWidth: '100%' }}>
                <colgroup>
                  <col style={{ width: 50 }} />
                  <col />
                </colgroup>
                <tbody>
                  {lines.map((line, i) => {
                    const lineNum = i + 1;
                    const isChanged = changedLines.has(lineNum);
                    const bgCls = isChanged ? (viewMode === 'original' ? lineColors.removed : lineColors.added) : '';
                    const textCls = isChanged ? (viewMode === 'original' ? lineTextColors.removed : lineTextColors.added) : 'text-gray-800 dark:text-gray-200';
                    const gutterCls = isChanged ? (viewMode === 'original' ? gutterColors.removed : gutterColors.added) : 'bg-gray-50 dark:bg-gray-800/50 text-gray-400 dark:text-gray-500';
                    return (
                      <tr key={i} className={`hover:brightness-95 ${bgCls}`} data-line={lineNum}>
                        <td className={`text-right px-2 py-0 select-none ${gutterCls}`}>{lineNum}</td>
                        <td className={`px-3 py-0 whitespace-pre ${textCls}`}>{renderHighlighted(line)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })() : viewMode === 'split' ? (
          <div className="flex" ref={splitContainerRef}>
            {/* Left pane (old) */}
            <div
              ref={leftPaneRef}
              className="overflow-x-auto overflow-y-auto"
              style={{ width: `calc(${parseFloat(splitRatio) * 100}% - 3px)` }}
              onScroll={() => handleSplitScroll('left')}
            >
              <table className="border-collapse" style={{ minWidth: '100%' }}>
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col />
                </colgroup>
                <tbody>
                  {renderHunks(splitHunks, (idx) => renderSplitLeftLine(idx), 2)}
                </tbody>
              </table>
            </div>
            {/* Draggable separator */}
            <div
              className="flex-shrink-0 w-[5px] bg-gray-300 dark:bg-gray-600 cursor-col-resize hover:bg-blue-400 dark:hover:bg-blue-500 active:bg-blue-500 dark:active:bg-blue-400 transition-colors relative group"
              onMouseDown={handleSeparatorMouseDown}
              onDoubleClick={() => setSplitRatio('0.5')}
              title="Drag to resize · Double-click to reset"
            >
              <div className="absolute inset-y-0 -left-1 -right-1" />
            </div>
            {/* Right pane (new) */}
            <div
              ref={rightPaneRef}
              className="overflow-x-auto overflow-y-auto"
              style={{ width: `calc(${(1 - parseFloat(splitRatio)) * 100}% - 2px)` }}
              onScroll={() => handleSplitScroll('right')}
            >
              <table className="border-collapse" style={{ minWidth: '100%' }}>
                <colgroup>
                  <col style={{ width: 40 }} />
                  <col style={{ width: 20 }} />
                  <col />
                </colgroup>
                <tbody>
                  {renderHunks(splitHunks, (idx) => renderSplitRightLine(idx), 3)}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="border-collapse" style={{ minWidth: '100%' }}>
              <tbody>
                {renderHunks(hunks, renderDiffLine, 4)}
              </tbody>
            </table>
          </div>
        )}

        {unmatchedThreads.length > 0 && (
          <div className="border-t border-gray-200 dark:border-gray-700 p-4 font-sans">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">
              💬 {unmatchedThreads.length} comment{unmatchedThreads.length !== 1 ? 's' : ''} on this file (not matched to a diff line):
            </p>
            {unmatchedThreads.map((thread) => (
              <div key={thread.id} className="mb-3">
                <InlineThread thread={thread} onReply={onReply} onSetStatus={onSetStatus} onDeleteComment={onDeleteComment} onToggleLike={onToggleLike} usersMap={usersMap} currentUserId={currentUserId} isPrOwner={isPrOwner} hiddenThreadIds={hiddenThreadIds} onToggleHideThread={onToggleHideThread} knownUsers={knownUsers} onMentionInserted={onMentionInserted} />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function DiffLineRow({
  line, lineColors, lineTextColors, gutterColors, moveLineColors, moveLineTextColors, moveGutterColors, lineThreads,
  isCommentOpen, onGutterClick, commentText, onCommentTextChange,
  sending, onSubmitComment, onCancelComment, onReply, onSetStatus, onDeleteComment, onToggleLike,
  usersMap, currentUserId, isPrOwner, hiddenThreadIds, onToggleHideThread, knownUsers, onMentionInserted,
  autoExpand, onAutoExpandHandled, renderHighlighted,
}: {
  line: DiffLine;
  lineColors: Record<string, string>;
  lineTextColors: Record<string, string>;
  gutterColors: Record<string, string>;
  moveLineColors: Record<string, string>;
  moveLineTextColors: Record<string, string>;
  moveGutterColors: Record<string, string>;
  lineThreads: PullRequestThread[];
  isCommentOpen: boolean;
  onGutterClick: () => void;
  commentText: string;
  onCommentTextChange: (v: string) => void;
  sending: boolean;
  onSubmitComment: () => void;
  onCancelComment: () => void;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  onToggleLike?: (threadId: number, commentId: number, currentUserId: string) => Promise<void>;
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  hiddenThreadIds?: Set<number>;
  onToggleHideThread?: (threadId: number) => void;
  knownUsers?: IdentitySearchResult[];
  onMentionInserted?: (user: IdentitySearchResult) => void;
  autoExpand?: boolean;
  onAutoExpandHandled?: () => void;
  renderHighlighted: (content: string) => React.ReactNode;
}) {
  const isMoved = line.moveId != null;
  const bgColor = isMoved ? (moveLineColors[line.type] ?? lineColors[line.type]) : lineColors[line.type];
  const textColor = isMoved ? (moveLineTextColors[line.type] ?? lineTextColors[line.type]) : lineTextColors[line.type];
  const gutter = isMoved ? (moveGutterColors[line.type] ?? gutterColors[line.type]) : gutterColors[line.type];
  const prefix = isMoved
    ? (line.moveSide === 'source' ? '↰' : '↳')
    : line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <tr className={`${bgColor} hover:brightness-95`} data-line={line.newLineNum ?? undefined} title={isMoved ? `Moved code (block ${line.moveId})` : undefined}>
      <td className={`w-10 text-right px-2 py-0 select-none ${gutter}`}>{line.oldLineNum ?? ''}</td>
      <td className={`w-10 text-right px-2 py-0 select-none ${gutter}`}>{line.newLineNum ?? ''}</td>
      <td
        className={`w-5 text-center px-1 py-0 select-none ${gutter} ${lineThreads.length > 0 ? '' : 'cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900'}`}
        onClick={lineThreads.length > 0 ? undefined : onGutterClick}
        title={lineThreads.length > 0 ? undefined : 'Add comment'}
      >
        {lineThreads.length > 0 ? (
          <CommentIndicator
            lineThreads={lineThreads}
            onReply={onReply}
            onSetStatus={onSetStatus}
            onDeleteComment={onDeleteComment}
            onToggleLike={onToggleLike}
            usersMap={usersMap}
            currentUserId={currentUserId}
            isPrOwner={isPrOwner}
            hiddenThreadIds={hiddenThreadIds}
            onToggleHideThread={onToggleHideThread}
            knownUsers={knownUsers}
            onMentionInserted={onMentionInserted}
            autoExpand={autoExpand}
            onAutoExpandHandled={onAutoExpandHandled}
          />
        ) : (
          line.newLineNum ? (
            <AddCommentPopover
              isOpen={isCommentOpen}
              onGutterClick={onGutterClick}
              commentText={commentText}
              onCommentTextChange={onCommentTextChange}
              sending={sending}
              onSubmitComment={onSubmitComment}
              onCancelComment={onCancelComment}
              knownUsers={knownUsers}
              onMentionInserted={onMentionInserted}
            />
          ) : ''
        )}
      </td>
      <td className={`px-3 py-0 whitespace-pre ${textColor}`}>
        <span className="select-none opacity-50 mr-1">{prefix}</span>
        {renderHighlighted(line.content)}
      </td>
    </tr>
  );
}

function AddCommentPopover({
  isOpen,
  onGutterClick,
  commentText,
  onCommentTextChange,
  sending,
  onSubmitComment,
  onCancelComment,
  knownUsers,
  onMentionInserted,
}: {
  isOpen: boolean;
  onGutterClick: () => void;
  commentText: string;
  onCommentTextChange: (v: string) => void;
  sending: boolean;
  onSubmitComment: () => void;
  onCancelComment: () => void;
  knownUsers?: IdentitySearchResult[];
  onMentionInserted?: (user: IdentitySearchResult) => void;
}) {
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePos = useCallback(() => {
    if (indicatorRef.current) {
      const rect = indicatorRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4 + window.scrollY,
        left: rect.left + window.scrollX,
      });
    }
  }, []);

  // Recalculate position when popover opens
  useEffect(() => {
    if (isOpen) {
      updatePos();
    }
  }, [isOpen, updatePos]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    updatePos();
    onGutterClick();
  }, [onGutterClick, updatePos]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        indicatorRef.current && !indicatorRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        onCancelComment();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen, onCancelComment]);

  return (
    <>
      <span
        ref={indicatorRef}
        onClick={handleClick}
        className="cursor-pointer hover:text-blue-600 dark:hover:text-blue-400"
        title="Add comment"
      >
        +
      </span>
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-[9999] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl font-sans"
          style={{ top: pos.top, left: pos.left, width: 400 }}
        >
          <div className="p-3">
            <MentionTextarea
              value={commentText}
              onChange={onCommentTextChange}
              rows={3}
              placeholder="Write your comment... (@ to mention)"
              className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              knownUsers={knownUsers}
              onMentionInserted={onMentionInserted}
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button onClick={onCancelComment} className="text-xs text-gray-500 dark:text-gray-400 hover:underline">Cancel</button>
              <button
                onClick={onSubmitComment}
                disabled={sending || !commentText.trim()}
                className="px-3 py-1 bg-blue-500 text-white rounded-full text-xs font-medium hover:bg-blue-600 disabled:opacity-50"
              >
                {sending ? 'Posting...' : 'Add Comment'}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function CommentIndicator({
  lineThreads,
  onReply,
  onSetStatus,
  onDeleteComment,
  onToggleLike,
  usersMap,
  currentUserId,
  isPrOwner,
  hiddenThreadIds,
  onToggleHideThread,
  knownUsers,
  onMentionInserted,
  autoExpand,
  onAutoExpandHandled,
}: {
  lineThreads: PullRequestThread[];
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  onToggleLike?: (threadId: number, commentId: number, currentUserId: string) => Promise<void>;
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  hiddenThreadIds?: Set<number>;
  onToggleHideThread?: (threadId: number) => void;
  knownUsers?: IdentitySearchResult[];
  onMentionInserted?: (user: IdentitySearchResult) => void;
  autoExpand?: boolean;
  onAutoExpandHandled?: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const updatePos = useCallback(() => {
    if (indicatorRef.current) {
      const rect = indicatorRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4 + window.scrollY,
        left: rect.left + window.scrollX,
      });
    }
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    if (isOpen) {
      setIsOpen(false);
    } else {
      updatePos();
      setIsOpen(true);
    }
  }, [isOpen, updatePos]);

  // Auto-expand after a comment was just posted on this line
  useEffect(() => {
    if (autoExpand) {
      updatePos();
      setIsOpen(true);
      onAutoExpandHandled?.();
    }
  }, [autoExpand, updatePos, onAutoExpandHandled]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (
        indicatorRef.current && !indicatorRef.current.contains(e.target as Node) &&
        popoverRef.current && !popoverRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const hasActive = lineThreads.some((t) => t.status === 'active');
  const count = lineThreads.length;
  const firstComment = lineThreads[0]?.comments?.[0];
  const avatarUrl = firstComment?.author?.imageUrl;
  const authorName = firstComment?.author?.displayName ?? '';
  const initials = authorName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const totalComments = lineThreads.reduce((sum, t) => sum + t.comments.filter((c) => isTextComment(c.commentType)).length, 0);
  const extraCount = totalComments - 1;

  return (
    <>
      <span
        ref={indicatorRef}
        onClick={handleClick}
        className="cursor-pointer inline-flex items-center gap-0.5"
        title={`${count} thread${count !== 1 ? 's' : ''}, ${totalComments} comment${totalComments !== 1 ? 's' : ''} – ${authorName}`}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={authorName}
            className={`rounded-full object-cover ring-1 ${hasActive ? 'ring-blue-400' : 'ring-green-400'}`}
            style={{ width: 16, height: 16, minWidth: 16, minHeight: 16 }}
          />
        ) : (
          <span
            className={`rounded-full flex items-center justify-center text-[7px] font-bold text-white ${hasActive ? 'bg-blue-500' : 'bg-green-500'}`}
            style={{ width: 16, height: 16, minWidth: 16, minHeight: 16 }}
          >
            {initials}
          </span>
        )}
        {extraCount > 0 && (
          <span className="text-[8px] font-semibold text-gray-500 dark:text-gray-400 leading-none">+{extraCount}</span>
        )}
      </span>
      {isOpen && createPortal(
        <div
          ref={popoverRef}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          className="absolute z-[9999] bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl max-h-80 overflow-y-auto"
          style={{ top: pos.top, left: pos.left, width: 450 }}
        >
          <div className="p-3 space-y-3">
            {lineThreads.map((thread) => (
              <InlineThread
                key={thread.id}
                thread={thread}
                onReply={onReply}
                onSetStatus={onSetStatus}
                onDeleteComment={onDeleteComment}
                onToggleLike={onToggleLike}
                usersMap={usersMap}
                currentUserId={currentUserId}
                isPrOwner={isPrOwner}
                hiddenThreadIds={hiddenThreadIds}
                onToggleHideThread={onToggleHideThread}
                knownUsers={knownUsers}
                onMentionInserted={onMentionInserted}
              />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}

function InlineThread({
  thread, onReply, onSetStatus, onDeleteComment, onToggleLike, usersMap, currentUserId, isPrOwner, hiddenThreadIds, onToggleHideThread, knownUsers, onMentionInserted,
}: {
  thread: PullRequestThread;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  onToggleLike?: (threadId: number, commentId: number, currentUserId: string) => Promise<void>;
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  hiddenThreadIds?: Set<number>;
  onToggleHideThread?: (threadId: number) => void;
  knownUsers?: IdentitySearchResult[];
  onMentionInserted?: (user: IdentitySearchResult) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const hidden = hiddenThreadIds?.has(thread.id) ?? false;

  const textComments = thread.comments.filter((c) => isTextComment(c.commentType));

  const handleReply = async () => {
    if (!replyText.trim()) return;
    setSending(true);
    try {
      await onReply(thread.id, replyText);
      setReplyText('');
      setShowReply(false);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="font-sans text-sm space-y-1">
      {hidden && (
        <div className="flex items-center gap-2 text-xs">
          <span className={`rounded px-1 py-0.5 font-medium ${thread.status === 'active' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400' : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'}`}>
            {thread.status}
          </span>
          <span className="text-gray-400 dark:text-gray-500 italic">({textComments.length} comment{textComments.length !== 1 ? 's' : ''} hidden)</span>
          <button onClick={() => onToggleHideThread?.(thread.id)} className="text-blue-600 dark:text-blue-400 hover:underline">Show</button>
        </div>
      )}
      {!hidden && (
        <>
          {textComments.map((c) => {
            const isMe = currentUserId != null && c.author.id === currentUserId;
            return (
              <div key={c.id} className={`group/comment flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                <div className="flex-shrink-0 mt-1">
                  {c.author.imageUrl ? (
                    <img src={c.author.imageUrl} alt={c.author.displayName} className="rounded-full object-cover" style={{ width: 22, height: 22, minWidth: 22, minHeight: 22 }} />
                  ) : (
                    <span className="rounded-full bg-gray-400 text-white flex items-center justify-center text-[8px] font-bold" style={{ width: 22, height: 22, minWidth: 22, minHeight: 22 }}>
                      {c.author.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </span>
                  )}
                </div>
                <div className={`max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-baseline gap-1.5 mb-0.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                    <span className="font-medium text-gray-600 dark:text-gray-300 text-[11px]">{c.author.displayName}</span>
                    <span className="text-gray-400 dark:text-gray-500 text-[10px]">{formatDate(c.publishedDate)}</span>
                  </div>
                  <div className={`rounded-2xl px-3 py-1.5 ${isMe ? 'bg-blue-500 text-white rounded-tr-sm' : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-100 rounded-tl-sm'}`}>
                    <MarkdownContent content={c.content} className={`text-sm [&_p]:m-0 ${isMe ? 'text-white [&_a]:text-blue-100' : 'text-gray-800 dark:text-gray-100'}`} usersMap={usersMap} />
                  </div>
                  {onToggleLike && currentUserId && (
                    <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} transition-opacity duration-200 ${
                      (c.usersLiked?.length ?? 0) === 0 ? 'opacity-0 group-hover/comment:opacity-100' : ''
                    }`}>
                      <button
                        onClick={() => onToggleLike(thread.id, c.id, currentUserId)}
                        className={`text-[11px] mt-0.5 flex items-center gap-1 transition-colors duration-200 ${
                          c.usersLiked?.some((u) => u.id === currentUserId)
                            ? 'text-blue-600 dark:text-blue-400'
                            : 'text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400'
                        }`}
                        title={c.usersLiked?.map((u) => u.displayName).join(', ') || 'Like'}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                          <path d="M1 8.25a1.25 1.25 0 1 1 2.5 0v7.5a1.25 1.25 0 1 1-2.5 0v-7.5ZM5.5 6V3.5a2.5 2.5 0 0 1 5 0V6h3.25a2.25 2.25 0 0 1 2.227 2.568l-1 7A2.25 2.25 0 0 1 12.75 17.5H5.5V6Z" />
                        </svg>
                        {(c.usersLiked?.length ?? 0) > 0 && <span>{c.usersLiked!.length}</span>}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {showReply && (
            <div className="mt-2">
              <MentionTextarea value={replyText} onChange={setReplyText} rows={2}
                className="w-full border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="Reply... (@ to mention)"
                knownUsers={knownUsers} onMentionInserted={onMentionInserted} />
              <div className="flex gap-2 mt-1 justify-end">
                <button onClick={() => setShowReply(false)} className="text-xs text-gray-500 dark:text-gray-400 hover:underline">Cancel</button>
                <button onClick={handleReply} disabled={sending}
                  className="px-3 py-1 bg-blue-500 text-white rounded-full text-xs disabled:opacity-50">Reply</button>
              </div>
            </div>
          )}
          {!showReply && (
            <div className={`flex items-center justify-between text-xs ${textComments.length > 0 ? 'mt-1' : ''}`}>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowReply(true)} className="text-blue-600 dark:text-blue-400 hover:underline">Reply</button>
              {isPrOwner && thread.status === 'active' && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'fixed')} className="text-green-600 dark:text-green-400 hover:underline">Resolve</button>
                </>
              )}
              {isPrOwner && thread.status !== 'active' && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'active')} className="text-blue-600 dark:text-blue-400 hover:underline">Reopen</button>
                </>
              )}
              {onDeleteComment && textComments.length > 0 && currentUserId && textComments[textComments.length - 1].author.id === currentUserId && (
                <>
                  <span className="text-gray-300 dark:text-gray-600">|</span>
                  <button onClick={() => setConfirmDelete(true)}
                    className="text-red-400 dark:text-red-500 hover:text-red-600 dark:hover:text-red-400 hover:underline">Delete</button>
                </>
              )}
              </div>
              <span className={`rounded px-1.5 py-0.5 font-medium ${thread.status === 'active' ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400' : 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400'}`}>
                {thread.status}
              </span>
            </div>
          )}
        </>
      )}
      <ConfirmDialog
        open={confirmDelete}
        title="Delete Comment"
        message="Are you sure you want to delete this comment?"
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => {
          setConfirmDelete(false);
          onDeleteComment?.(thread.id, textComments[textComments.length - 1].id);
        }}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
