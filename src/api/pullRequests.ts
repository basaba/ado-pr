import { adoClient } from './client';
import type {
  AdoListResponse,
  PullRequest,
  IdentityRef,
  VoteValue,
} from '../types';

const prBasePath = (repoId: string, prId: number) =>
  `/git/repositories/${repoId}/pullrequests/${prId}`;

export interface PrSearchFilters {
  reviewerId?: string;
  creatorId?: string;
  status?: string; // active | completed | abandoned | all
}

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
  return searchPullRequests({ reviewerId: profile.id, status: 'active' });
}

export async function searchPullRequests(filters: PrSearchFilters = {}): Promise<PullRequest[]> {
  const params: Record<string, string> = {
    'searchCriteria.status': filters.status || 'active',
  };
  if (filters.reviewerId) params['searchCriteria.reviewerId'] = filters.reviewerId;
  if (filters.creatorId) params['searchCriteria.creatorId'] = filters.creatorId;
  const data = await adoClient.get<AdoListResponse<PullRequest>>(
    '/git/pullrequests',
    params,
  );
  return data.value;
}

export interface IdentitySearchResult {
  id: string;
  displayName: string;
  mail?: string;
  image?: string;
}

/** Search for identities by display name or email */
export async function searchIdentities(query: string): Promise<IdentitySearchResult[]> {
  if (!query || query.length < 2) return [];
  try {
    // Use the org-level Identity Picker API (POST)
    const url = `${window.location.origin}/ado-proxy/_apis/IdentityPicker/Identities?api-version=7.1-preview`;
    const headers: Record<string, string> = {
      ...adoClient.headers,
      'X-Ado-Org-Url': adoClient.orgUrl,
    };
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: query,
        identityTypes: ['user', 'group'],
        operationScopes: ['ims', 'source'],
        options: { MinResults: 5, MaxResults: 20 },
        properties: ['DisplayName', 'Mail', 'ScopeName'],
      }),
    });
    if (!res.ok) {
      throw new Error(`Identity search failed: ${res.status}`);
    }
    const data = await res.json();
    if (data.results && data.results.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data.results[0].identities.map((i: any) => ({
        id: i.localId || i.originId || i.entityId || i.id || '',
        displayName: i.displayName || '',
        mail: i.mail || i.signInAddress || '',
      }));
    }
    return [];
  } catch {
    // Fallback: try the older org-level _apis/identities API
    try {
      const data = await adoClient.getOrg<{ value: { id: string; providerDisplayName: string; properties?: { Mail?: { $value: string } } }[] }>(
        `/identities?searchFilter=General&filterValue=${encodeURIComponent(query)}&queryMembership=None`,
        '7.1-preview',
      );
      return (data.value || []).map((i) => ({
        id: i.id,
        displayName: i.providerDisplayName,
        mail: i.properties?.Mail?.$value,
      }));
    } catch {
      return [];
    }
  }
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
