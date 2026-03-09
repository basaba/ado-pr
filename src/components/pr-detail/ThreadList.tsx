import { useState, useCallback } from 'react';
import type { PullRequestThread, ThreadStatus } from '../../types';
import { formatDate, isTextComment } from '../../utils';
import { MarkdownContent, MentionTextarea, ConfirmDialog } from '../common';
import type { IdentitySearchResult } from '../../api/pullRequests';

interface Props {
  threads: PullRequestThread[];
  onReply: (threadId: number, content: string) => Promise<void>;
  onSetStatus: (threadId: number, status: ThreadStatus) => Promise<void>;
  onDeleteComment?: (threadId: number, commentId: number) => Promise<void>;
  onToggleLike?: (threadId: number, commentId: number, currentUserId: string) => Promise<void>;
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  onNavigateToFile?: (filePath: string, line?: number) => void;
  knownUsers?: IdentitySearchResult[];
  onMentionInserted?: (user: IdentitySearchResult) => void;
}

export function ThreadList({ threads, onReply, onSetStatus, onDeleteComment, onToggleLike, usersMap, currentUserId, isPrOwner, onNavigateToFile, knownUsers, onMentionInserted }: Props) {
  if (threads.length === 0) {
    return <p className="text-gray-400 dark:text-gray-500 text-sm italic">No threads yet.</p>;
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
          onToggleLike={onToggleLike}
          usersMap={usersMap}
          currentUserId={currentUserId}
          isPrOwner={isPrOwner}
          onNavigateToFile={onNavigateToFile}
          knownUsers={knownUsers}
          onMentionInserted={onMentionInserted}
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
  onToggleLike,
  usersMap,
  currentUserId,
  isPrOwner,
  onNavigateToFile,
  knownUsers,
  onMentionInserted,
}: {
  thread: PullRequestThread;
  onReply: Props['onReply'];
  onSetStatus: Props['onSetStatus'];
  onDeleteComment?: Props['onDeleteComment'];
  onToggleLike?: Props['onToggleLike'];
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  onNavigateToFile?: (filePath: string, line?: number) => void;
  knownUsers?: IdentitySearchResult[];
  onMentionInserted?: (user: IdentitySearchResult) => void;
}) {
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const [sending, setSending] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
    active: 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-400',
    fixed: 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-400',
    wontFix: 'bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200',
    closed: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300',
    pending: 'bg-yellow-100 dark:bg-yellow-900/40 text-yellow-700 dark:text-yellow-400',
    byDesign: 'bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-400',
  };

  return (
    <div className="border border-gray-200 dark:border-gray-700 rounded-2xl overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Thread header */}
      <div className="flex items-center justify-between px-4 py-2 text-xs">
        <div className="flex items-center gap-2">
          {thread.threadContext?.filePath && (
            onNavigateToFile ? (
              <button
                onClick={() => onNavigateToFile(thread.threadContext!.filePath, thread.threadContext!.rightFileStart?.line)}
                className="text-blue-600 dark:text-blue-400 hover:underline font-mono"
              >
                {thread.threadContext.filePath}
                {thread.threadContext.rightFileStart && `:${thread.threadContext.rightFileStart.line}`}
              </button>
            ) : (
              <span className="text-gray-500 dark:text-gray-400 font-mono">
                {thread.threadContext.filePath}
                {thread.threadContext.rightFileStart && `:${thread.threadContext.rightFileStart.line}`}
              </span>
            )
          )}
          {hidden && (
            <span className="text-gray-400 dark:text-gray-500 italic">
              ({textComments.length} comment{textComments.length !== 1 ? 's' : ''} hidden)
            </span>
          )}
        </div>
        {hidden && (
          <button onClick={() => setHidden(false)} className="text-blue-600 dark:text-blue-400 hover:underline">
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
                <div key={comment.id} className={`group/comment flex gap-2 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className="flex-shrink-0 mt-1">
                    {comment.author.imageUrl ? (
                      <img src={comment.author.imageUrl} alt={comment.author.displayName} className="rounded-full object-cover" style={{ width: 22, height: 22, minWidth: 22, minHeight: 22 }} />
                    ) : (
                      <span className="rounded-full bg-gray-400 dark:bg-gray-500 text-white flex items-center justify-center text-[8px] font-bold" style={{ width: 22, height: 22, minWidth: 22, minHeight: 22 }}>
                        {comment.author.displayName.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className={`max-w-[80%] ${isMe ? 'items-end' : 'items-start'}`}>
                    <div className={`flex items-baseline gap-1.5 mb-0.5 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
                      <span className="font-medium text-gray-600 dark:text-gray-300 text-[11px]">{comment.author.displayName}</span>
                      <span className="text-gray-400 dark:text-gray-500 text-[10px]">{formatDate(comment.publishedDate)}</span>
                    </div>
                    <div className={`rounded-2xl px-3 py-1.5 ${isMe ? 'bg-blue-500 text-white rounded-tr-sm' : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-tl-sm border border-gray-200 dark:border-gray-700'}`}>
                      <MarkdownContent content={comment.content} className={`text-sm [&_p]:m-0 ${isMe ? 'text-white [&_a]:text-blue-100' : 'text-gray-800 dark:text-gray-100'}`} usersMap={usersMap} />
                    </div>
                    {onToggleLike && currentUserId && (
                      <div className={`flex ${isMe ? 'justify-end' : 'justify-start'} transition-opacity duration-200 ${
                        (comment.usersLiked?.length ?? 0) === 0 ? 'opacity-0 group-hover/comment:opacity-100' : ''
                      }`}>
                        <button
                          onClick={() => onToggleLike(thread.id, comment.id, currentUserId)}
                          className={`text-[11px] mt-0.5 flex items-center gap-1 transition-colors duration-200 ${
                            comment.usersLiked?.some((u) => u.id === currentUserId)
                              ? 'text-blue-600 dark:text-blue-400'
                              : 'text-gray-400 dark:text-gray-500 hover:text-blue-500 dark:hover:text-blue-400'
                          }`}
                          title={comment.usersLiked?.map((u) => u.displayName).join(', ') || 'Like'}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M1 8.25a1.25 1.25 0 1 1 2.5 0v7.5a1.25 1.25 0 1 1-2.5 0v-7.5ZM5.5 6V3.5a2.5 2.5 0 0 1 5 0V6h3.25a2.25 2.25 0 0 1 2.227 2.568l-1 7A2.25 2.25 0 0 1 12.75 17.5H5.5V6Z" />
                          </svg>
                          {(comment.usersLiked?.length ?? 0) > 0 && <span>{comment.usersLiked!.length}</span>}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Reply form */}
          {showReply && (
            <div className="px-4 py-2">
              <MentionTextarea
                value={replyText}
                onChange={setReplyText}
                rows={2}
                placeholder="Reply... (@ to mention)"
                className="w-full border border-gray-300 dark:border-gray-600 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
                knownUsers={knownUsers}
                onMentionInserted={onMentionInserted}
              />
              <div className="flex gap-2 mt-1 justify-end">
                <button onClick={() => setShowReply(false)} className="text-xs text-gray-500 dark:text-gray-400 hover:underline">Cancel</button>
                <button onClick={handleReply} disabled={sending || !replyText.trim()}
                  className="px-3 py-1 bg-blue-500 text-white rounded-full text-xs font-medium hover:bg-blue-600 disabled:opacity-50">
                  {sending ? 'Sending...' : 'Reply'}
                </button>
              </div>
            </div>
          )}

          {/* Action buttons + status */}
          <div className="flex items-center justify-between px-4 py-2 border-t border-gray-200 dark:border-gray-700 text-xs">
            <div className="flex items-center gap-2">
              {!showReply && (
                <button onClick={() => setShowReply(true)} className="text-blue-600 dark:text-blue-400 hover:underline">Reply</button>
              )}
              {isPrOwner && thread.status === 'active' && (
                <>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'fixed')} className="text-green-600 dark:text-green-400 hover:underline">Resolve</button>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'wontFix')} className="text-gray-500 dark:text-gray-400 hover:underline">Won't Fix</button>
                </>
              )}
              {isPrOwner && (thread.status === 'fixed' || thread.status === 'wontFix' || thread.status === 'closed') && (
                <>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => onSetStatus(thread.id, 'active')} className="text-blue-600 dark:text-blue-400 hover:underline">Reopen</button>
                </>
              )}
              {onDeleteComment && textComments.length > 0 && currentUserId && textComments[textComments.length - 1].author.id === currentUserId && (
                <>
                  <span className="text-gray-300">|</span>
                  <button onClick={() => setConfirmDelete(true)}
                    className="text-red-400 dark:text-red-500 hover:text-red-600 hover:underline">Delete</button>
                </>
              )}
            </div>
            <span className={`rounded px-1.5 py-0.5 font-medium ${statusColor[thread.status] || 'bg-gray-100 dark:bg-gray-700'}`}>
              {thread.status}
            </span>
          </div>
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
