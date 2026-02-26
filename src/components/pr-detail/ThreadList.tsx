import { useState } from 'react';
import type { PullRequestThread, ThreadStatus } from '../../types';
import { formatDate, isTextComment } from '../../utils';
import { MarkdownContent } from '../common';

interface Props {
  threads: PullRequestThread[];
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  usersMap?: Record<string, string>;
  onNavigateToFile?: (filePath: string, line?: number) => void;
}

export function ThreadList({ threads, onReply, onSetStatus, onDeleteComment, usersMap, onNavigateToFile }: Props) {
  if (threads.length === 0) {
    return <p className="text-gray-400 text-sm italic">No threads yet.</p>;
  }

  return (
    <div className="space-y-4">
      {threads.map((thread) => (
        <ThreadItem
          key={thread.id}
          thread={thread}
          onReply={onReply}
          onSetStatus={onSetStatus}
          onDeleteComment={onDeleteComment}
          usersMap={usersMap}
          onNavigateToFile={onNavigateToFile}
        />
      ))}
    </div>
  );
}

function ThreadItem({
  thread,
  onReply,
  onSetStatus,
  onDeleteComment,
  usersMap,
  onNavigateToFile,
}: {
  thread: PullRequestThread;
  onReply: Props['onReply'];
  onSetStatus: Props['onSetStatus'];
  onDeleteComment?: Props['onDeleteComment'];
  usersMap?: Record<string, string>;
  onNavigateToFile?: (filePath: string, line?: number) => void;
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

  const statusColor: Record<string, string> = {
    active: 'bg-blue-100 text-blue-700',
    fixed: 'bg-green-100 text-green-700',
    wontFix: 'bg-gray-100 text-gray-700',
    closed: 'bg-gray-100 text-gray-600',
    pending: 'bg-yellow-100 text-yellow-700',
    byDesign: 'bg-purple-100 text-purple-700',
  };

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Thread header */}
      <div className="flex items-center justify-between bg-gray-50 px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 font-medium ${statusColor[thread.status] || 'bg-gray-100'}`}>
            {thread.status}
          </span>
          {thread.threadContext?.filePath && (
            onNavigateToFile ? (
              <button
                onClick={() => onNavigateToFile(thread.threadContext!.filePath, thread.threadContext!.rightFileStart?.line)}
                className="text-blue-600 hover:underline font-mono"
              >
                {thread.threadContext.filePath}
                {thread.threadContext.rightFileStart && `:${thread.threadContext.rightFileStart.line}`}
              </button>
            ) : (
              <span className="text-gray-500 font-mono">
                {thread.threadContext.filePath}
                {thread.threadContext.rightFileStart && `:${thread.threadContext.rightFileStart.line}`}
              </span>
            )
          )}
        </div>
        <div className="flex gap-1">
          {thread.status === 'active' && (
            <>
              <button
                onClick={() => onSetStatus(thread.id, 'fixed')}
                className="text-green-600 hover:underline"
              >
                Resolve
              </button>
              <span className="text-gray-300">|</span>
              <button
                onClick={() => onSetStatus(thread.id, 'wontFix')}
                className="text-gray-500 hover:underline"
              >
                Won't Fix
              </button>
            </>
          )}
          {(thread.status === 'fixed' || thread.status === 'wontFix' || thread.status === 'closed') && (
            <button
              onClick={() => onSetStatus(thread.id, 'active')}
              className="text-blue-600 hover:underline"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      {/* Comments */}
      <div className="divide-y divide-gray-100">
        {textComments.map((comment) => (
          <div key={comment.id} className="px-4 py-3">
            <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
              <span className="font-medium text-gray-700">{comment.author.displayName}</span>
              <span>{formatDate(comment.publishedDate)}</span>
              {onDeleteComment && (
                <button
                  onClick={() => {
                    if (confirm('Delete this comment?')) {
                      onDeleteComment(thread.id, comment.id);
                    }
                  }}
                  className="ml-auto text-red-400 hover:text-red-600 hover:underline"
                >
                  Delete
                </button>
              )}
            </div>
            <MarkdownContent content={comment.content} className="text-sm text-gray-800" usersMap={usersMap} />
          </div>
        ))}
      </div>

      {/* Reply */}
      <div className="px-4 py-2 border-t border-gray-100">
        {showReply ? (
          <div>
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={2}
              placeholder="Write a reply..."
              className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <div className="flex gap-2 mt-1 justify-end">
              <button
                onClick={() => setShowReply(false)}
                className="text-xs text-gray-500 hover:underline"
              >
                Cancel
              </button>
              <button
                onClick={handleReply}
                disabled={sending || !replyText.trim()}
                className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {sending ? 'Sending...' : 'Reply'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowReply(true)}
            className="text-xs text-blue-600 hover:underline"
          >
            Reply
          </button>
        )}
      </div>
    </div>
  );
}
