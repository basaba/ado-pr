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
  currentUserId?: string;
  isPrOwner?: boolean;
  onNavigateToFile?: (filePath: string, line?: number) => void;
}

export function ThreadList({ threads, onReply, onSetStatus, onDeleteComment, usersMap, currentUserId, isPrOwner, onNavigateToFile }: Props) {
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
          currentUserId={currentUserId}
          isPrOwner={isPrOwner}
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
  currentUserId,
  isPrOwner,
  onNavigateToFile,
}: {
  thread: PullRequestThread;
  onReply: Props['onReply'];
  onSetStatus: Props['onSetStatus'];
  onDeleteComment?: Props['onDeleteComment'];
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  onNavigateToFile?: (filePath: string, line?: number) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [hidden, setHidden] = useState(false);

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
    <div className="border border-gray-200 rounded-2xl overflow-hidden bg-gray-50">
      {/* Thread header */}
      <div className="flex items-center justify-between px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
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
          {hidden && (
            <span className="text-gray-400 italic">
              ({textComments.length} comment{textComments.length !== 1 ? 's' : ''} hidden)
            </span>
          )}
        </div>
        {hidden && (
          <button onClick={() => setHidden(false)} className="text-blue-600 hover:underline">
            Show
          </button>
        )}
      </div>

      {!hidden && (
        <>
          {/* Comments as bubbles */}
          <div className="px-4 py-2 space-y-2">
            {textComments.map((comment) => {
              const isMe = currentUserId != null && comment.author.id === currentUserId;
              return (
                <div key={comment.id} className={`flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className="flex-shrink-0 mt-1">
                    {comment.author.imageUrl ? (
                      <img src={comment.author.imageUrl} alt={comment.author.displayName} className="rounded-full object-cover" style={{ width: 22, height: 22, minWidth: 22, minHeight: 22 }} />
                    ) : (
                      <span className="rounded-full bg-gray-400 text-white flex items-center justify-center text-[8px] font-bold" style={{ width: 22, height: 22, minWidth: 22, minHeight: 22 }}>
                        {comment.author.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className={`max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-baseline gap-1.5 mb-0.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                      <span className="font-medium text-gray-600 text-[11px]">{comment.author.displayName}</span>
                      <span className="text-gray-400 text-[10px]">{formatDate(comment.publishedDate)}</span>
                    </div>
                    <div className={`rounded-2xl px-3 py-1.5 ${isMe ? 'bg-blue-500 text-white rounded-tr-sm' : 'bg-white text-gray-800 rounded-tl-sm border border-gray-200'}`}>
                      <MarkdownContent content={comment.content} className={`text-sm [&_p]:m-0 ${isMe ? 'text-white [&_a]:text-blue-100' : 'text-gray-800'}`} usersMap={usersMap} />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reply form */}
          {showReply && (
            <div className="px-4 py-2">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={2}
                placeholder="Reply..."
                className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              <div className="flex gap-2 mt-1 justify-end">
                <button onClick={() => setShowReply(false)} className="text-xs text-gray-500 hover:underline">Cancel</button>
                <button onClick={handleReply} disabled={sending || !replyText.trim()}
                  className="px-3 py-1 bg-blue-500 text-white rounded-full text-xs font-medium hover:bg-blue-600 disabled:opacity-50">
                  {sending ? 'Sending...' : 'Reply'}
                </button>
              </div>
            </div>
          )}

          {/* Action buttons + status */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 text-xs">
            <div className="flex items-center gap-2">
              {!showReply && (
                <button onClick={() => setShowReply(true)} className="text-blue-600 hover:underline">Reply</button>
              )}
              {isPrOwner && thread.status === 'active' && (
                <>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'fixed')} className="text-green-600 hover:underline">Resolve</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'wontFix')} className="text-gray-500 hover:underline">Won't Fix</button>
                </>
              )}
              {isPrOwner && (thread.status === 'fixed' || thread.status === 'wontFix' || thread.status === 'closed') && (
                <>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'active')} className="text-blue-600 hover:underline">Reopen</button>
                </>
              )}
              {onDeleteComment && textComments.length > 0 && currentUserId && textComments[textComments.length - 1].author.id === currentUserId && (
                <>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => { if (confirm('Delete this comment?')) onDeleteComment(thread.id, textComments[textComments.length - 1].id); }}
                    className="text-red-400 hover:text-red-600 hover:underline">Delete</button>
                </>
              )}
            </div>
            <span className={`rounded px-1.5 py-0.5 font-medium ${statusColor[thread.status] || 'bg-gray-100'}`}>
              {thread.status}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
