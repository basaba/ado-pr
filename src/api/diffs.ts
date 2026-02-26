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

// Fetch raw text content via full URL
export async function getFileContentByUrl(url: string): Promise<string> {
  try {
    return await adoClient.getText(url);
  } catch {
    return '';
  }
}
