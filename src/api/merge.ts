export interface MergeStartResult {
  status: 'clean' | 'conflicts' | 'error';
  conflicts?: string[];
  message?: string;
  worktreePath?: string;
}

export interface ConflictFile {
  path: string;
  baseContent: string;
  oursContent: string;
  theirsContent: string;
}

export interface ConflictsResult {
  files: ConflictFile[];
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data as T;
}

export async function startMerge(
  repoPath: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<MergeStartResult> {
  return postJson('/git/merge/start', { repoPath, sourceBranch, targetBranch });
}

export async function getConflicts(repoPath: string, worktreePath?: string): Promise<ConflictsResult> {
  return postJson('/git/merge/conflicts', { repoPath, worktreePath });
}

export async function resolveFile(
  repoPath: string,
  filePath: string,
  resolution: 'ours' | 'theirs' | 'manual',
  content?: string,
  worktreePath?: string,
): Promise<void> {
  await postJson('/git/merge/resolve-file', { repoPath, filePath, resolution, content, worktreePath });
}

export async function completeMerge(
  repoPath: string,
  commitMessage?: string,
  worktreePath?: string,
): Promise<void> {
  await postJson('/git/merge/complete', { repoPath, commitMessage, worktreePath });
}

export async function abortMerge(repoPath: string, worktreePath?: string): Promise<void> {
  await postJson('/git/merge/abort', { repoPath, worktreePath });
}
