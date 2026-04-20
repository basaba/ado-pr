export interface ParsedAdoPrUrl {
  serverUrl: string;
  organization: string;
  project: string;
  repo: string;
  prId: number;
}

/**
 * Parse an Azure DevOps pull request URL.
 *
 * Supported shapes:
 *   https://dev.azure.com/{org}/{project}/_git/{repo}/pullrequest/{id}
 *   https://{org}.visualstudio.com/{project}/_git/{repo}/pullrequest/{id}
 *
 * Trailing query strings, fragments, and additional path segments
 * (e.g. `/files`, `/overview`) are ignored.
 */
export function parseAdoPrUrl(input: string): ParsedAdoPrUrl | null {
  const raw = input.trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);

  // Find the "pullrequest" segment followed by a numeric id.
  const prIdx = segments.findIndex((s) => s.toLowerCase() === 'pullrequest');
  if (prIdx < 0 || prIdx + 1 >= segments.length) return null;
  const prId = Number(segments[prIdx + 1]);
  if (!Number.isFinite(prId) || prId <= 0) return null;

  // Expect: ... <project> _git <repo> pullrequest <id>
  const gitIdx = segments.lastIndexOf('_git', prIdx);
  if (gitIdx < 1 || gitIdx + 1 >= prIdx) return null;
  const repo = segments[gitIdx + 1];
  const project = segments[gitIdx - 1];
  if (!repo || !project) return null;

  const host = url.hostname.toLowerCase();
  let organization: string;
  let serverUrl: string;
  if (host === 'dev.azure.com' || host === 'ssh.dev.azure.com') {
    // dev.azure.com/{org}/{project}/_git/{repo}/...
    if (gitIdx < 2) return null;
    organization = segments[gitIdx - 2];
    serverUrl = `${url.protocol}//dev.azure.com`;
  } else if (host.endsWith('.visualstudio.com')) {
    organization = host.slice(0, -'.visualstudio.com'.length);
    serverUrl = `${url.protocol}//${host}`;
  } else {
    // Fall back: assume dev.azure.com style with org as first segment.
    if (gitIdx < 2) return null;
    organization = segments[gitIdx - 2];
    serverUrl = `${url.protocol}//${host}`;
  }

  if (!organization) return null;

  return { serverUrl, organization, project, repo, prId };
}
