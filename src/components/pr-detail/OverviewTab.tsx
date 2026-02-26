import type { PullRequest } from '../../types';
import { VOTE_LABELS, VOTE_COLORS } from '../../types';
import type { useThreads } from '../../hooks';
import { isTextComment } from '../../utils';
import { MarkdownContent } from '../common';
import { ThreadList } from './ThreadList';

interface Props {
  pr: PullRequest;
  threads: ReturnType<typeof useThreads>;
}

export function OverviewTab({ pr, threads }: Props) {
  // Filter general (non-file-specific) threads
  const generalThreads = threads.threads.filter(
    (t) => !t.threadContext?.filePath && t.comments.some((c) => isTextComment(c.commentType)),
  );

  return (
    <div className="space-y-6">
      {/* Description */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Description</h2>
        {pr.description ? (
          <div className="bg-gray-50 rounded p-4">
            <MarkdownContent content={pr.description} className="text-gray-700" />
          </div>
        ) : (
          <p className="text-gray-400 text-sm italic">No description provided.</p>
        )}
      </section>

      {/* Reviewers */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">Reviewers</h2>
        <div className="space-y-2">
          {pr.reviewers.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-sm">
              <span className="font-medium text-gray-800">{r.displayName}</span>
              <span className={`text-xs ${VOTE_COLORS[r.vote] || 'text-gray-400'}`}>
                {VOTE_LABELS[r.vote] || 'No vote'}
              </span>
              {r.isRequired && (
                <span className="text-xs text-orange-600 font-medium">Required</span>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* General comments */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-2">
          Comments ({generalThreads.length})
        </h2>
        <ThreadList
          threads={generalThreads}
          onReply={threads.reply}
          onSetStatus={threads.setStatus}
          onDeleteComment={threads.removeComment}
        />
        <NewCommentBox onSubmit={(content) => threads.addThread(content)} />
      </section>
    </div>
  );
}

function NewCommentBox({ onSubmit }: { onSubmit: (content: string) => Promise<unknown> }) {
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
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment..."
        rows={3}
        className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
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

import { useState } from 'react';
