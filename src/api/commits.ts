import { adoClient } from './client';
import type { AdoListResponse, GitCommitRef, CommitChange } from '../types';

export async function listPrCommits(
  repoId: string,
  prId: number,
): Promise<GitCommitRef[]> {
  const data = await adoClient.get<AdoListResponse<GitCommitRef>>(
    `/git/repositories/${repoId}/pullrequests/${prId}/commits`,
  );
  return data.value;
}

export async function getCommitDetails(
  repoId: string,
  commitId: string,
): Promise<GitCommitRef> {
  return adoClient.get<GitCommitRef>(
    `/git/repositories/${repoId}/commits/${commitId}`,
    { changeCount: '0' },
  );
}

const CHANGE_TYPE_MAP: Record<number, string> = {
  1: 'add',
  2: 'edit',
  8: 'rename',
  16: 'delete',
};

function normalizeChangeType(ct: number | string): 'add' | 'edit' | 'delete' | 'rename' {
  if (typeof ct === 'string') return ct as 'add' | 'edit' | 'delete' | 'rename';
  return (CHANGE_TYPE_MAP[ct] ?? 'edit') as 'add' | 'edit' | 'delete' | 'rename';
}

export interface CommitChangeNormalized {
  path: string;
  changeType: 'add' | 'edit' | 'delete' | 'rename';
  originalPath?: string;
}

export async function getCommitChanges(
  repoId: string,
  commitId: string,
): Promise<CommitChangeNormalized[]> {
  const data = await adoClient.get<{ changes: CommitChange[] }>(
    `/git/repositories/${repoId}/commits/${commitId}/changes`,
  );
  return (data.changes ?? [])
    .filter((c) => !c.item.isFolder)
    .map((c) => ({
      path: c.item.path,
      changeType: normalizeChangeType(c.changeType),
      originalPath: c.originalPath,
    }));
}
