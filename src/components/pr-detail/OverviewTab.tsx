import type { PullRequest } from '../../types';
import { VOTE_LABELS, VOTE_COLORS } from '../../types';
import type { useThreads } from '../../hooks';
import { isTextComment } from '../../utils';
import { MarkdownContent, MentionTextarea } from '../common';
import { ThreadList } from './ThreadList';
import type { IdentitySearchResult } from '../../api/pullRequests';

interface Props {
  pr: PullRequest;
  threads: ReturnType<typeof useThreads>;
  usersMap: Record<string, string>;
  currentUserId?: string;
  knownUsers?: IdentitySearchResult[];
  onMentionInserted?: (user: IdentitySearchResult) => void;
  isEditable?: boolean;
  onUpdateDescription?: (description: string) => Promise<void>;
}

export function OverviewTab({ pr, threads, usersMap, currentUserId, knownUsers: knownUsersProp, onMentionInserted, isEditable, onUpdateDescription }: Props) {
  const [editingDesc, setEditingDesc] = useState(false);
  const [descDraft, setDescDraft] = useState('');
  const [savingDesc, setSavingDesc] = useState(false);

  // Filter general (non-file-specific) threads
  const generalThreads = threads.threads.filter(
    (t) => !t.threadContext?.filePath && t.comments.some((c) => isTextComment(c.commentType)),
  );

  const knownUsers: IdentitySearchResult[] = useMemo(
    () => knownUsersProp ?? Object.entries(usersMap).map(([id, displayName]) => ({ id, displayName })),
    [knownUsersProp, usersMap],
  );

  return (
    <div className="space-y-6">
      {/* Description */}
      <section>
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">Description</h2>
          {isEditable && !editingDesc && (
            <button
              onClick={() => { setDescDraft(pr.description || ''); setEditingDesc(true); }}
              className="text-xs text-blue-600 dark:text-blue-400 hover:underline"
            >
              Edit
            </button>
          )}
        </div>
        {editingDesc ? (
          <div>
            <textarea
              autoFocus
              value={descDraft}
              onChange={(e) => setDescDraft(e.target.value)}
              rows={8}
              className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100 font-mono"
              placeholder="Enter description (Markdown supported)..."
            />
            <div className="flex justify-end gap-2 mt-2">
              <button
                onClick={() => setEditingDesc(false)}
                className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded transition-colors"
              >
                Cancel
              </button>
              <button
                disabled={savingDesc}
                onClick={async () => {
                  if (onUpdateDescription) {
                    setSavingDesc(true);
                    await onUpdateDescription(descDraft);
                    setSavingDesc(false);
                  }
                  setEditingDesc(false);
                }}
                className="px-3 py-1.5 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded transition-colors disabled:opacity-50"
              >
                {savingDesc ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        ) : pr.description ? (
          <div className="bg-gray-50 dark:bg-gray-900 rounded p-4">
            <MarkdownContent content={pr.description} className="text-gray-700 dark:text-gray-200" usersMap={usersMap} />
          </div>
        ) : (
          <p className="text-gray-400 dark:text-gray-500 text-sm italic">
            No description provided.
            {isEditable && (
              <button
                onClick={() => { setDescDraft(''); setEditingDesc(true); }}
                className="ml-2 text-blue-600 dark:text-blue-400 hover:underline not-italic"
              >
                Add one
              </button>
            )}
          </p>
        )}
      </section>

      {/* Reviewers */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">Reviewers</h2>
        <div className="space-y-2">
          {pr.reviewers.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium text-gray-800 dark:text-gray-100">{r.displayName}</span>
              <span className={`text-xs ${VOTE_COLORS[r.vote] || 'text-gray-400 dark:text-gray-500'}`}>
                {VOTE_LABELS[r.vote] || 'No vote'}
              </span>
              {r.isRequired && (
                <span className="text-xs text-orange-600 dark:text-orange-400 font-medium">Required</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* General comments */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200 mb-2">
          Comments ({generalThreads.length})
        </h2>
        <ThreadList
          threads={generalThreads}
          onReply={threads.reply}
          onSetStatus={threads.setStatus}
          onDeleteComment={threads.removeComment}
          usersMap={usersMap}
          currentUserId={currentUserId}
          knownUsers={knownUsers}
          onMentionInserted={onMentionInserted}
        />
        <NewCommentBox onSubmit={(content) => threads.addThread(content)} knownUsers={knownUsers} onMentionInserted={onMentionInserted} />
      </section>
    </div>
  );
}

function NewCommentBox({ onSubmit, knownUsers = [], onMentionInserted }: { onSubmit: (content: string) => Promise<unknown>; knownUsers?: IdentitySearchResult[]; onMentionInserted?: (user: IdentitySearchResult) => void }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);

  const handleSubmit = async () => {
    if (!text.trim()) return;
    setSending(true);
    try {
      await onSubmit(text);
      setText('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-4">
      <MentionTextarea
        value={text}
        onChange={setText}
        placeholder="Add a comment... (@ to mention)"
        rows={3}
        className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-gray-100"
        knownUsers={knownUsers}
        onMentionInserted={onMentionInserted}
      />
      <div className="flex justify-end mt-2">
        <button
          onClick={handleSubmit}
          disabled={sending || !text.trim()}
          className="px-4 py-1.5 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
        >
          {sending ? 'Posting...' : 'Comment'}
        </button>
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';
