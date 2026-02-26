import { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import type { PullRequestThread, ThreadStatus } from '../../types';
import { formatDate, isTextComment } from '../../utils';
import { MarkdownContent } from '../common';

interface Props {
  oldContent: string;
  newContent: string;
  filePath: string;
  threads: PullRequestThread[];
  onAddComment: (content: string, line: number) => Promise<void>;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  usersMap?: Record<string, string>;
  scrollToLine?: number;
  onScrollHandled?: () => void;
}

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
}

/** Number of unchanged context lines to show around each change/comment */
const CONTEXT_LINES = 3;

function computeDiffLines(oldText: string, newText: string): DiffLine[] {
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

export function DiffViewer({
  oldContent,
  newContent,
  threads,
  onAddComment,
  onReply,
  onSetStatus,
  onDeleteComment,
  usersMap,
  scrollToLine,
  onScrollHandled,
}: Props) {
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const [containerWidth, setContainerWidth] = useState(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

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

  const hasCollapsed = hunks.some((h) => h.kind === 'collapsed');

  // Scroll to a specific line when requested
  useEffect(() => {
    if (scrollToLine == null) return;
    // Small delay to let DOM render
    const timer = setTimeout(() => {
      const el = scrollContainerRef.current?.querySelector(`[data-line="${scrollToLine}"]`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('bg-yellow-200');
        setTimeout(() => el.classList.remove('bg-yellow-200'), 2000);
      }
      onScrollHandled?.();
    }, 100);
    return () => clearTimeout(timer);
  }, [scrollToLine, onScrollHandled]);

  const handleSubmitComment = async () => {
    if (!commentText.trim() || commentLine == null) return;
    setSending(true);
    try {
      await onAddComment(commentText, commentLine);
      setCommentText('');
      setCommentLine(null);
    } finally {
      setSending(false);
    }
  };

  const lineColors: Record<string, string> = {
    added: 'bg-green-50', removed: 'bg-red-50', unchanged: '',
  };
  const lineTextColors: Record<string, string> = {
    added: 'text-green-800', removed: 'text-red-800', unchanged: 'text-gray-700',
  };
  const gutterColors: Record<string, string> = {
    added: 'bg-green-100 text-green-700', removed: 'bg-red-100 text-red-700', unchanged: 'bg-gray-50 text-gray-400',
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
        commentBoxWidth={commentBoxWidth}
        usersMap={usersMap}
      />
    );
  };

  return (
    <div className="overflow-x-auto text-xs font-mono relative" ref={scrollContainerRef}>
      {hasCollapsed && (
        <div className="flex justify-end px-3 py-1.5 bg-gray-50 border-b border-gray-200 font-sans">
          <button
            onClick={() => { setExpanded(!expanded); setExpandedSections(new Set()); }}
            className="text-xs text-blue-600 hover:underline"
          >
            {expanded ? '⊟ Compact diff' : '⊞ Show full file'}
          </button>
        </div>
      )}

      <table className="w-full border-collapse">
        <tbody>
          {expanded
            ? diffLines.map((_, idx) => renderDiffLine(idx))
            : hunks.map((item, hunkIdx) => {
                if (item.kind === 'line') return renderDiffLine(item.idx);
                if (expandedSections.has(hunkIdx)) {
                  // Render all lines in this expanded section
                  const lines = [];
                  for (let i = item.fromIdx; i <= item.toIdx; i++) {
                    lines.push(renderDiffLine(i));
                  }
                  return lines;
                }
                return (
                  <tr key={`sep-${hunkIdx}`}>
                    <td
                      colSpan={4}
                      className="bg-blue-50 text-center text-xs text-blue-500 py-1 select-none cursor-pointer hover:bg-blue-100 font-sans"
                      onClick={() => setExpandedSections((prev) => new Set(prev).add(hunkIdx))}
                    >
                      ⋯ {item.hiddenCount} unchanged line{item.hiddenCount !== 1 ? 's' : ''} hidden ⋯
                    </td>
                  </tr>
                );
              })}
        </tbody>
      </table>

      {unmatchedThreads.length > 0 && (
        <div className="border-t border-gray-200 p-4 font-sans">
          <p className="text-xs text-gray-500 mb-2">
            💬 {unmatchedThreads.length} comment{unmatchedThreads.length !== 1 ? 's' : ''} on this file (not matched to a diff line):
          </p>
          {unmatchedThreads.map((thread) => (
            <div key={thread.id} className="mb-3">
              <InlineThread thread={thread} onReply={onReply} onSetStatus={onSetStatus} onDeleteComment={onDeleteComment} usersMap={usersMap} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function DiffLineRow({
  line, lineColors, lineTextColors, gutterColors, lineThreads,
  isCommentOpen, onGutterClick, commentText, onCommentTextChange,
  sending, onSubmitComment, onCancelComment, onReply, onSetStatus, onDeleteComment,
  commentBoxWidth, usersMap,
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
  commentBoxWidth: string;
  usersMap?: Record<string, string>;
}) {
  const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <>
      <tr className={`${lineColors[line.type]} hover:brightness-95`} data-line={line.newLineNum ?? undefined}>
        <td className={`w-10 text-right px-2 py-0 select-none ${gutterColors[line.type]}`}>{line.oldLineNum ?? ''}</td>
        <td className={`w-10 text-right px-2 py-0 select-none ${gutterColors[line.type]}`}>{line.newLineNum ?? ''}</td>
        <td
          className={`w-5 text-center px-1 py-0 select-none cursor-pointer hover:bg-blue-100 ${gutterColors[line.type]}`}
          onClick={onGutterClick}
          title="Add comment"
        >
          {line.newLineNum ? '+' : ''}
        </td>
        <td className={`px-3 py-0 whitespace-pre ${lineTextColors[line.type]}`}>
          <span className="select-none opacity-50 mr-1">{prefix}</span>
          {line.content}
        </td>
      </tr>

      {lineThreads.map((thread) => (
        <tr key={`thread-${thread.id}`}>
          <td colSpan={4} className="bg-blue-50 border-l-4 border-blue-400 p-0">
            <div className="px-6 py-2" style={{ width: commentBoxWidth, maxWidth: commentBoxWidth }}>
              <InlineThread thread={thread} onReply={onReply} onSetStatus={onSetStatus} onDeleteComment={onDeleteComment} usersMap={usersMap} />
            </div>
          </td>
        </tr>
      ))}

      {isCommentOpen && (
        <tr>
          <td colSpan={4} className="bg-yellow-50 border-l-4 border-yellow-400 p-0">
            <div className="px-6 py-3" style={{ width: commentBoxWidth, maxWidth: commentBoxWidth }}>
              <textarea
                value={commentText}
                onChange={(e) => onCommentTextChange(e.target.value)}
                rows={3}
                placeholder="Write your comment..."
                className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
              />
              <div className="flex gap-2 mt-2 justify-end">
                <button onClick={onCancelComment} className="text-xs text-gray-500 hover:underline font-sans">Cancel</button>
                <button
                  onClick={onSubmitComment}
                  disabled={sending || !commentText.trim()}
                  className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 font-sans"
                >
                  {sending ? 'Posting...' : 'Add Comment'}
                </button>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function InlineThread({
  thread, onReply, onSetStatus, onDeleteComment, usersMap,
}: {
  thread: PullRequestThread;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  usersMap?: Record<string, string>;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [sending, setSending] = useState(false);

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
      <div className="flex items-center gap-2 text-xs">
        <span className={`rounded px-1 py-0.5 font-medium ${thread.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'}`}>
          {thread.status}
        </span>
        {thread.status === 'active' ? (
          <button onClick={() => onSetStatus(thread.id, 'fixed')} className="text-green-600 hover:underline">Resolve</button>
        ) : (
          <button onClick={() => onSetStatus(thread.id, 'active')} className="text-blue-600 hover:underline">Reopen</button>
        )}
      </div>
      {textComments.map((c) => (
        <div key={c.id} className="pl-2 border-l-2 border-gray-200">
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700 text-xs">{c.author.displayName}</span>
            <span className="text-gray-400 text-xs">{formatDate(c.publishedDate)}</span>
            {onDeleteComment && (
              <button
                onClick={() => { if (confirm('Delete this comment?')) onDeleteComment(thread.id, c.id); }}
                className="text-red-400 hover:text-red-600 text-xs hover:underline ml-auto"
              >
                Delete
              </button>
            )}
          </div>
          <MarkdownContent content={c.content} className="text-gray-800 text-sm" usersMap={usersMap} />
        </div>
      ))}
      {showReply ? (
        <div className="mt-1">
          <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} rows={2}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <div className="flex gap-2 mt-1 justify-end">
            <button onClick={() => setShowReply(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
            <button onClick={handleReply} disabled={sending}
              className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50">Reply</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowReply(true)} className="text-xs text-blue-600 hover:underline">Reply</button>
      )}
    </div>
  );
}
