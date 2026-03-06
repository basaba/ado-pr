import { VOTE_LABELS, VOTE_COLORS } from '../../types';
import type { Reviewer } from '../../types';

interface Props {
  reviewers: Reviewer[];
  currentUserId?: string;
}

const VOTE_ICON: Record<number, string> = {
  10: '✓',
  5: '✓~',
  '-5': '⏳',
  '-10': '✗',
};

const VOTE_BG: Record<number, string> = {
  10: 'bg-green-50',
  5: 'bg-green-50',
  '-5': 'bg-yellow-50',
  '-10': 'bg-red-50',
};

const VOTE_PRIORITY: Record<number, number> = {
  '-10': 0,
  '-5': 1,
  5: 2,
  10: 3,
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export function ReviewerVotes({ reviewers, currentUserId }: Props) {
  const voted = reviewers
    .filter((r) => r.vote !== 0 && !r.isContainer)
    .sort((a, b) => (VOTE_PRIORITY[a.vote] ?? 99) - (VOTE_PRIORITY[b.vote] ?? 99));

  if (voted.length === 0) {
    return <span className="text-xs text-gray-400">No votes</span>;
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap justify-end">
      {voted.map((r) => (
        <span
          key={r.id}
          title={`${r.displayName}: ${VOTE_LABELS[r.vote] || 'Unknown'}${r.isRequired ? ' (required)' : ''}`}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
            VOTE_BG[r.vote] || 'bg-gray-50'
          } ${VOTE_COLORS[r.vote] || 'text-gray-400'} ${
            r.id === currentUserId ? 'ring-1 ring-blue-400' : ''
          }`}
        >
          <span>{VOTE_ICON[r.vote] || '?'}</span>
          {r.imageUrl ? (
            <img
              src={r.imageUrl}
              alt={r.displayName}
              className="w-4 h-4 rounded-full object-cover"
            />
          ) : (
            <span className="opacity-70">{initials(r.displayName)}</span>
          )}
        </span>
      ))}
    </div>
  );
}
