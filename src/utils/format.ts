export function formatDate(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString();
}

export function branchName(refName: string): string {
  return refName.replace('refs/heads/', '');
}

export function changeTypeLabel(ct: string): string {
  switch (ct) {
    case 'add': return 'Added';
    case 'edit': return 'Modified';
    case 'delete': return 'Deleted';
    case 'rename': return 'Renamed';
    default: return ct;
  }
}

export function changeTypeBadgeColor(ct: string): string {
  switch (ct) {
    case 'add': return 'bg-green-100 text-green-800';
    case 'edit': return 'bg-blue-100 text-blue-800';
    case 'delete': return 'bg-red-100 text-red-800';
    case 'rename': return 'bg-yellow-100 text-yellow-800';
    default: return 'bg-gray-100 text-gray-800';
  }
}
