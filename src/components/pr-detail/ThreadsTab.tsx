import { useState } from 'react';
import type { useThreads } from '../../hooks';
import type { ThreadStatus } from '../../types';
import { isTextComment } from '../../utils';
import { ThreadList } from './ThreadList';

interface Props {
  threads: ReturnType<typeof useThreads>;
}

const STATUS_FILTERS: { label: string; value: ThreadStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Resolved', value: 'fixed' },
  { label: "Won't Fix", value: 'wontFix' },
  { label: 'Closed', value: 'closed' },
];

export function ThreadsTab({ threads }: Props) {
  const [filter, setFilter] = useState<ThreadStatus | 'all'>('all');

  // Only text threads (exclude system)
  const textThreads = threads.threads.filter((t) =>
    t.comments.some((c) => isTextComment(c.commentType)),
  );

  const filtered =
    filter === 'all'
      ? textThreads
      : textThreads.filter((t) => t.status === filter);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
            {f.value !== 'all' && (
              <span className="ml-1">
                ({textThreads.filter((t) => t.status === f.value).length})
              </span>
            )}
          </button>
        ))}
      </div>

      <ThreadList
        threads={filtered}
        onReply={threads.reply}
        onSetStatus={threads.setStatus}
        onDeleteComment={threads.removeComment}
      />
    </div>
  );
}
