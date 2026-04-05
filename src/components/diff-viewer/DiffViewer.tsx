import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import type { PullRequestThread, ThreadStatus } from '../../types';
import { formatDate, isTextComment } from '../../utils';
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
  viewMode?: 'unified' | 'split';
}

export interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
}

/** Number of unchanged context lines to show around each change/comment */
const CONTEXT_LINES = 3;

export function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        oldLines[i - 1] === newLines[j - 1]
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const result: DiffLine[] = [];
  let i = m, j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'unchanged', oldLineNum: i, newLineNum: j, content: oldLines[i - 1] });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: 'added', oldLineNum: null, newLineNum: j, content: newLines[j - 1] });
      j--;
    } else {
      stack.push({ type: 'removed', oldLineNum: i, newLineNum: null, content: oldLines[i - 1] });
      i--;
    }
  }

  while (stack.length) result.push(stack.pop()!);
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

  const diffLines = useMemo(() => computeDiffLines(oldContent, newContent), [oldContent, newContent]);

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

  // Threads not matched to any diff line
  const matchedLineSet = new Set<number>();
  diffLines.forEach((l) => { if (l.newLineNum) matchedLineSet.add(l.newLineNum); });
  const unmatchedThreads = threads.filter((t) => {
    const line = t.threadContext?.rightFileStart?.line;
    return !line || !matchedLineSet.has(line);
  });

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
      />
    );
  };

  const renderSplitDiffLine = (idx: number) => {
    const pair = splitPairs[idx];
    const newLineNum = pair.right?.newLineNum ?? null;
    const lineThreads = newLineNum ? threadsByLine[newLineNum] || [] : [];

    return (
      <SplitDiffLineRow
        key={idx}
        pair={pair}
        lineColors={lineColors}
        lineTextColors={lineTextColors}
        gutterColors={gutterColors}
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
      />
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
              {colSpan <= 4 ? (
                <>
                  <td colSpan={2} className="bg-blue-50 dark:bg-blue-900/30 group-hover:bg-blue-100 dark:group-hover:bg-blue-900 text-center text-blue-400 text-lg px-1 py-1 w-[1px]">↕</td>
                  <td colSpan={2} className="bg-blue-50 dark:bg-blue-900/30 group-hover:bg-blue-100 dark:group-hover:bg-blue-900" />
                </>
              ) : (
                <td colSpan={colSpan} className="bg-blue-50 dark:bg-blue-900/30 group-hover:bg-blue-100 dark:group-hover:bg-blue-900 text-center text-blue-400 text-lg px-1 py-1">↕</td>
              )}
            </tr>
          );
        });
  };

  return (
    <div className="text-xs font-mono relative" ref={scrollContainerRef}>
      <div className="min-w-0 overflow-x-auto">
        {hasCollapsed && (
          <div className="flex justify-end px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 font-sans">
            <button
              onClick={() => { setExpanded(!isExpanded); setExpandedSections(new Set()); }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              {isExpanded ? '⊟ Compact diff' : '⊞ Show full file'}
            </button>
          </div>
        )}

        {viewMode === 'split' ? (
          <table className="w-full border-collapse table-fixed">
            <colgroup>
              <col style={{ width: 40 }} />
              <col />
              <col style={{ width: 1 }} />
              <col style={{ width: 40 }} />
              <col style={{ width: 20 }} />
              <col />
            </colgroup>
            <tbody>
              {renderHunks(splitHunks, renderSplitDiffLine, 6)}
            </tbody>
          </table>
        ) : (
          <table className="w-full border-collapse">
            <tbody>
              {renderHunks(hunks, renderDiffLine, 4)}
            </tbody>
          </table>
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
  line, lineColors, lineTextColors, gutterColors, lineThreads,
  isCommentOpen, onGutterClick, commentText, onCommentTextChange,
  sending, onSubmitComment, onCancelComment, onReply, onSetStatus, onDeleteComment, onToggleLike,
  usersMap, currentUserId, isPrOwner, hiddenThreadIds, onToggleHideThread, knownUsers, onMentionInserted,
  autoExpand, onAutoExpandHandled,
}: {
  line: DiffLine;
  lineColors: Record<string, string>;
  lineTextColors: Record<string, string>;
  gutterColors: Record<string, string>;
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
}) {
  const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <tr className={`${lineColors[line.type]} hover:brightness-95`} data-line={line.newLineNum ?? undefined}>
      <td className={`w-10 text-right px-2 py-0 select-none ${gutterColors[line.type]}`}>{line.oldLineNum ?? ''}</td>
      <td className={`w-10 text-right px-2 py-0 select-none ${gutterColors[line.type]}`}>{line.newLineNum ?? ''}</td>
      <td
        className={`w-5 text-center px-1 py-0 select-none ${gutterColors[line.type]} ${lineThreads.length > 0 ? '' : 'cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900'}`}
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
      <td className={`px-3 py-0 whitespace-pre ${lineTextColors[line.type]}`}>
        <span className="select-none opacity-50 mr-1">{prefix}</span>
        {line.content}
      </td>
    </tr>
  );
}

function SplitDiffLineRow({
  pair, lineColors, lineTextColors, gutterColors, lineThreads,
  isCommentOpen, onGutterClick, commentText, onCommentTextChange,
  sending, onSubmitComment, onCancelComment, onReply, onSetStatus, onDeleteComment, onToggleLike,
  usersMap, currentUserId, isPrOwner, hiddenThreadIds, onToggleHideThread, knownUsers, onMentionInserted,
  autoExpand, onAutoExpandHandled,
}: {
  pair: SplitPair;
  lineColors: Record<string, string>;
  lineTextColors: Record<string, string>;
  gutterColors: Record<string, string>;
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
}) {
  const leftType = pair.left?.type ?? 'unchanged';
  const rightType = pair.right?.type ?? 'unchanged';
  const leftEmpty = !pair.left;
  const rightEmpty = !pair.right;

  const emptyBg = 'bg-gray-100 dark:bg-gray-800';
  const leftPrefix = pair.left?.type === 'removed' ? '-' : ' ';
  const rightPrefix = pair.right?.type === 'added' ? '+' : ' ';

  return (
    <tr className="hover:brightness-95" data-line={pair.right?.newLineNum ?? undefined}>
      {/* Left: old line number */}
      <td className={`text-right px-2 py-0 select-none ${leftEmpty ? emptyBg : gutterColors[leftType]}`}>
        {pair.left?.oldLineNum ?? ''}
      </td>
      {/* Left: old content */}
      <td className={`px-3 py-0 whitespace-pre overflow-hidden ${leftEmpty ? emptyBg : `${lineColors[leftType]} ${lineTextColors[leftType]}`}`}>
        {pair.left && (
          <>
            <span className="select-none opacity-50 mr-1">{leftPrefix}</span>
            {pair.left.content}
          </>
        )}
      </td>
      {/* Divider */}
      <td className="bg-gray-300 dark:bg-gray-600" />
      {/* Right: new line number */}
      <td className={`text-right px-2 py-0 select-none ${rightEmpty ? emptyBg : gutterColors[rightType]}`}>
        {pair.right?.newLineNum ?? ''}
      </td>
      {/* Right: comment gutter */}
      <td
        className={`text-center px-1 py-0 select-none ${rightEmpty ? emptyBg : gutterColors[rightType]} ${lineThreads.length > 0 || rightEmpty ? '' : 'cursor-pointer hover:bg-blue-100 dark:hover:bg-blue-900'}`}
        onClick={lineThreads.length > 0 || rightEmpty ? undefined : onGutterClick}
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
            autoExpand={autoExpand}
            onAutoExpandHandled={onAutoExpandHandled}
          />
        ) : (
          pair.right?.newLineNum ? (
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
      {/* Right: new content */}
      <td className={`px-3 py-0 whitespace-pre overflow-hidden ${rightEmpty ? emptyBg : `${lineColors[rightType]} ${lineTextColors[rightType]}`}`}>
        {pair.right && (
          <>
            <span className="select-none opacity-50 mr-1">{rightPrefix}</span>
            {pair.right.content}
          </>
        )}
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
