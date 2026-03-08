import { useMemo } from 'react';
import type { useThreads } from '../../hooks';
import { useSearchParamState, useSearchParamStateSet } from '../../hooks';
import type { ThreadStatus } from '../../types';
import { isTextComment } from '../../utils';
import { ThreadList } from './ThreadList';

interface Props {
  threads: ReturnType<typeof useThreads>;
  usersMap?: Record<string, string>;
  currentUserId?: string;
  isPrOwner?: boolean;
  onNavigateToFile?: (filePath: string, line?: number) => void;
}

const STATUS_FILTERS: { label: string; value: ThreadStatus | 'all' }[] = [
  { label: 'All', value: 'all' },
  { label: 'Active', value: 'active' },
  { label: 'Resolved', value: 'fixed' },
  { label: "Won't Fix", value: 'wontFix' },
  { label: 'Closed', value: 'closed' },
];

export function ThreadsTab({ threads, usersMap, currentUserId, isPrOwner, onNavigateToFile }: Props) {
  const [filterParam, setFilter] = useSearchParamState('threadStatus', 'all');
  const filter = filterParam as ThreadStatus | 'all';
  const [selectedCommenters, setSelectedCommenters] = useSearchParamStateSet('commenters');

  // Only text threads (exclude system)
  const textThreads = threads.threads.filter((t) =>
    t.comments.some((c) => isTextComment(c.commentType)),
  );

  // Collect unique commenters from text comments
  const commenters = useMemo(() => {
    const map = new Map<string, string>();
    textThreads.forEach((t) =>
      t.comments.forEach((c) => {
        if (isTextComment(c.commentType)) map.set(c.author.id, c.author.displayName);
      }),
    );
    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threads.threads]);

  const toggleCommenter = (id: string) => {
    const next = new Set(selectedCommenters);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedCommenters(next);
  };

  let filtered = filter === 'all'
    ? textThreads
    : textThreads.filter((t) => t.status === filter);

  if (selectedCommenters.size > 0) {
    filtered = filtered.filter((t) =>
      t.comments.some((c) => isTextComment(c.commentType) && selectedCommenters.has(c.author.id)),
    );
  }

  return (
    <div>
      {/* Status filters */}
      <div className="flex items-center gap-2 mb-3">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
              filter === f.value
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
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

      {/* Commenter filters */}
      {commenters.length > 1 && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          <span className="text-xs text-gray-500 dark:text-gray-400">Commenters:</span>
          {commenters.map((c) => (
            <button
              key={c.id}
              onClick={() => toggleCommenter(c.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                selectedCommenters.has(c.id)
                  ? 'bg-purple-600 text-white'
                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
              }`}
            >
              {c.name}
            </button>
          ))}
          {selectedCommenters.size > 0 && (
            <button
              onClick={() => setSelectedCommenters(new Set())}
              className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-200 hover:underline"
            >
              Clear
            </button>
          )}
        </div>
      )}

      <ThreadList
        threads={filtered}
        onReply={threads.reply}
        onSetStatus={threads.setStatus}
        onDeleteComment={threads.removeComment}
        onToggleLike={threads.toggleLike}
        usersMap={usersMap}
        currentUserId={currentUserId}
        isPrOwner={isPrOwner}
        onNavigateToFile={onNavigateToFile}
      />
    </div>
  );
}
