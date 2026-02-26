import { useState, useMemo } from 'react';
import type { PullRequestThread, ThreadStatus } from '../../types';
import { formatDate } from '../../utils';

interface Props {
  oldContent: string;
  newContent: string;
  filePath: string;
  threads: PullRequestThread[];
  onAddComment: (content: string, line: number) => Promise<void>;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
}

interface DiffLine {
  type: 'unchanged' | 'added' | 'removed';
  oldLineNum: number | null;
  newLineNum: number | null;
  content: string;
}

function computeDiffLines(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');

  // Simple LCS-based diff
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
  let i = m,
    j = n;
  const stack: DiffLine[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: 'unchanged', oldLineNum: i, newLineNum: j, content: oldLines[i - 1] });
      i--;
      j--;
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

export function DiffViewer({
  oldContent,
  newContent,
  threads,
  onAddComment,
  onReply,
  onSetStatus,
}: Props) {
  const [commentLine, setCommentLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);

  const diffLines = useMemo(() => computeDiffLines(oldContent, newContent), [oldContent, newContent]);

  // Index threads by line number
  const threadsByLine: Record<number, PullRequestThread[]> = {};
  threads.forEach((t) => {
    const line = t.threadContext?.rightFileStart?.line;
    if (line) {
      if (!threadsByLine[line]) threadsByLine[line] = [];
      threadsByLine[line].push(t);
    }
  });

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
    added: 'bg-green-50',
    removed: 'bg-red-50',
    unchanged: '',
  };

  const lineTextColors: Record<string, string> = {
    added: 'text-green-800',
    removed: 'text-red-800',
    unchanged: 'text-gray-700',
  };

  const gutterColors: Record<string, string> = {
    added: 'bg-green-100 text-green-700',
    removed: 'bg-red-100 text-red-700',
    unchanged: 'bg-gray-50 text-gray-400',
  };

  return (
    <div className="overflow-x-auto text-xs font-mono">
      <table className="w-full border-collapse">
        <tbody>
          {diffLines.map((line, idx) => {
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
                isCommentOpen={commentLine === newLineNum}
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
                onCancelComment={() => {
                  setCommentLine(null);
                  setCommentText('');
                }}
                onReply={onReply}
                onSetStatus={onSetStatus}
              />
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function DiffLineRow({
  line,
  lineColors,
  lineTextColors,
  gutterColors,
  lineThreads,
  isCommentOpen,
  onGutterClick,
  commentText,
  onCommentTextChange,
  sending,
  onSubmitComment,
  onCancelComment,
  onReply,
  onSetStatus,
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
}) {
  const prefix = line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' ';

  return (
    <>
      <tr className={`${lineColors[line.type]} hover:brightness-95`}>
        <td className={`w-10 text-right px-2 py-0 select-none ${gutterColors[line.type]}`}>
          {line.oldLineNum ?? ''}
        </td>
        <td className={`w-10 text-right px-2 py-0 select-none ${gutterColors[line.type]}`}>
          {line.newLineNum ?? ''}
        </td>
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

      {/* Inline threads for this line */}
      {lineThreads.map((thread) => (
        <tr key={`thread-${thread.id}`}>
          <td colSpan={4} className="bg-blue-50 border-l-4 border-blue-400 px-6 py-2">
            <InlineThread thread={thread} onReply={onReply} onSetStatus={onSetStatus} />
          </td>
        </tr>
      ))}

      {/* New comment input */}
      {isCommentOpen && (
        <tr>
          <td colSpan={4} className="bg-yellow-50 border-l-4 border-yellow-400 px-6 py-3">
            <textarea
              value={commentText}
              onChange={(e) => onCommentTextChange(e.target.value)}
              rows={3}
              placeholder="Write your comment..."
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm font-sans focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoFocus
            />
            <div className="flex gap-2 mt-2 justify-end">
              <button
                onClick={onCancelComment}
                className="text-xs text-gray-500 hover:underline font-sans"
              >
                Cancel
              </button>
              <button
                onClick={onSubmitComment}
                disabled={sending || !commentText.trim()}
                className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50 font-sans"
              >
                {sending ? 'Posting...' : 'Add Comment'}
              </button>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function InlineThread({
  thread,
  onReply,
  onSetStatus,
}: {
  thread: PullRequestThread;
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [sending, setSending] = useState(false);

  const textComments = thread.comments.filter((c) => c.commentType === 'text');

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
        <span
          className={`rounded px-1 py-0.5 font-medium ${
            thread.status === 'active' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
          }`}
        >
          {thread.status}
        </span>
        {thread.status === 'active' && (
          <button
            onClick={() => onSetStatus(thread.id, 'fixed')}
            className="text-green-600 hover:underline"
          >
            Resolve
          </button>
        )}
        {thread.status !== 'active' && (
          <button
            onClick={() => onSetStatus(thread.id, 'active')}
            className="text-blue-600 hover:underline"
          >
            Reopen
          </button>
        )}
      </div>
      {textComments.map((c) => (
        <div key={c.id} className="pl-2 border-l-2 border-gray-200">
          <span className="font-medium text-gray-700 text-xs">{c.author.displayName}</span>
          <span className="text-gray-400 text-xs ml-2">{formatDate(c.publishedDate)}</span>
          <div className="text-gray-800 whitespace-pre-wrap">{c.content}</div>
        </div>
      ))}
      {showReply ? (
        <div className="mt-1">
          <textarea
            value={replyText}
            onChange={(e) => setReplyText(e.target.value)}
            rows={2}
            className="w-full border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <div className="flex gap-2 mt-1 justify-end">
            <button onClick={() => setShowReply(false)} className="text-xs text-gray-500 hover:underline">
              Cancel
            </button>
            <button
              onClick={handleReply}
              disabled={sending}
              className="px-2 py-0.5 bg-blue-600 text-white rounded text-xs disabled:opacity-50"
            >
              Reply
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowReply(true)} className="text-xs text-blue-600 hover:underline">
          Reply
        </button>
      )}
    </div>
  );
}
