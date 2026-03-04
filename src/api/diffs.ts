import { adoClient } from './client';
import type {
  AdoListResponse,
  PullRequestIteration,
  IterationChange,
} from '../types';

const basePath = (repoId: string, prId: number) =>
  `/git/repositories/${repoId}/pullrequests/${prId}`;

export async function listIterations(
  repoId: string,
  prId: number,
): Promise<PullRequestIteration[]> {
  const data = await adoClient.get<AdoListResponse<PullRequestIteration>>(
    `${basePath(repoId, prId)}/iterations`,
  );
  return data.value;
}

export async function getIterationChanges(
  repoId: string,
  prId: number,
  iterationId: number,
): Promise<IterationChange[]> {
  const data = await adoClient.get<{ changeEntries: IterationChange[] }>(
    `${basePath(repoId, prId)}/iterations/${iterationId}/changes`,
  );
  return data.changeEntries;
}

export async function getFileContent(
  repoId: string,
  path: string,
  commitId: string,
): Promise<string> {
  try {
    return await adoClient.get<string>(
      `/git/repositories/${repoId}/items`,
      {
        path,
        'versionDescriptor.version': commitId,
        'versionDescriptor.versionType': 'commit',
        includeContent: 'true',
        $format: 'text',
      },
    ) as unknown as string;
  } catch {
    return '';
  }
}

/** Fetch file content at a specific branch */
export async function getFileContentByBranch(
  repoId: string,
  path: string,
  branch: string,
): Promise<string> {
  try {
    return await adoClient.get<string>(
      `/git/repositories/${repoId}/items`,
      {
        path,
        'versionDescriptor.version': branch,
        'versionDescriptor.versionType': 'branch',
        includeContent: 'true',
        $format: 'text',
      },
    ) as unknown as string;
  } catch {
    return '';
  }
}

export interface BranchDiffChange {
  changeType: 'add' | 'edit' | 'delete' | 'rename';
  item: { path: string };
  originalPath?: string;
}

/** Get the diff (changed files) between two branches */
export async function getBranchDiff(
  repoId: string,
  sourceBranch: string,
  targetBranch: string,
): Promise<BranchDiffChange[]> {
  const data = await adoClient.get<{ changes: BranchDiffChange[] }>(
    `/git/repositories/${repoId}/diffs/commits`,
    {
      'baseVersion': targetBranch,
      'baseVersionType': 'branch',
      'targetVersion': sourceBranch,
      'targetVersionType': 'branch',
    },
  );
  return data.changes ?? [];
}

// Fetch raw text content via full URL
export async function getFileContentByUrl(url: string): Promise<string> {
  try {
    return await adoClient.getText(url);
  } catch {
    return '';
  }
}
