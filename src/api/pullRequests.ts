import { adoClient } from './client';
import type {
  AdoListResponse,
  PullRequest,
  IdentityRef,
  VoteValue,
} from '../types';

const prBasePath = (repoId: string, prId: number) =>
  `/git/repositories/${repoId}/pullrequests/${prId}`;

export async function getMyProfile(): Promise<IdentityRef> {
  const data = await adoClient.getOrg<{
    authenticatedUser: { id: string; providerDisplayName: string };
  }>('/connectionData');
  return {
    id: data.authenticatedUser.id,
    displayName: data.authenticatedUser.providerDisplayName,
    uniqueName: data.authenticatedUser.providerDisplayName,
  };
}

export async function listMyPullRequests(): Promise<PullRequest[]> {
  const profile = await getMyProfile();
  const data = await adoClient.get<AdoListResponse<PullRequest>>(
    '/git/pullrequests',
    {
      'searchCriteria.reviewerId': profile.id,
      'searchCriteria.status': 'active',
    },
  );
  return data.value;
}

export async function getPullRequest(
  repoId: string,
  prId: number,
): Promise<PullRequest> {
  return adoClient.get<PullRequest>(
    `/git/repositories/${repoId}/pullrequests/${prId}`,
  );
}

export async function votePullRequest(
  repoId: string,
  prId: number,
  reviewerId: string,
  vote: VoteValue,
): Promise<void> {
  await adoClient.put(`${prBasePath(repoId, prId)}/reviewers/${reviewerId}`, {
    vote,
  });
}
