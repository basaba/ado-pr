export interface MergeStartResult {
  status: 'clean' | 'conflicts' | 'error';
  conflicts?: string[];
  message?: string;
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

export async function getConflicts(repoPath: string): Promise<ConflictsResult> {
  return postJson('/git/merge/conflicts', { repoPath });
}

export async function resolveFile(
  repoPath: string,
  filePath: string,
  resolution: 'ours' | 'theirs' | 'manual',
  content?: string,
): Promise<void> {
  await postJson('/git/merge/resolve-file', { repoPath, filePath, resolution, content });
}

export async function completeMerge(
  repoPath: string,
  commitMessage?: string,
): Promise<void> {
  await postJson('/git/merge/complete', { repoPath, commitMessage });
}

export async function abortMerge(repoPath: string): Promise<void> {
  await postJson('/git/merge/abort', { repoPath });
}
