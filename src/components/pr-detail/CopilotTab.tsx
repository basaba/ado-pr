import { useCopilotTerminal } from '../../hooks/useCopilotTerminal';
import type { PullRequest } from '../../types';
import { useAuth } from '../../context';

interface CopilotTabProps {
  pr: PullRequest;
}

function branchName(ref: string) {
  return ref.replace(/^refs\/heads\//, '');
}

export function CopilotTab({ pr }: CopilotTabProps) {
  const { config } = useAuth();
  const repoPath = config?.repoPath;
  const adoOrgUrl = config ? `${config.serverUrl}/${config.organization}` : '';
  const adoProject = config?.project ?? '';

  const prPrompt = [
    `You are a helpful code review assistant for an Azure DevOps pull request.`,
    `Use the azure-devops MCP tools to fetch any details you need.`,
    '',
    `- PR #${pr.pullRequestId}: ${pr.title}`,
    `- Repository: ${pr.repository.name}`,
    `- Branch: ${branchName(pr.sourceRefName)} → ${branchName(pr.targetRefName)}`,
    `- Author: ${pr.createdBy.displayName}`,
    `- Project: ${adoProject}`,
    '',
    'Wait for the user to ask before taking any action.',
  ].join('\n');

  const { terminalRef, connected, error, exited, reconnect } = useCopilotTerminal({
    prPrompt,
    adoOrgUrl,
    adoProject,
    repoPath,
  });

  return (
    <div className="flex flex-col h-[600px]">
      {/* Status bar */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 text-xs">
        {repoPath && (
          <div className="flex items-center gap-1.5 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded px-2.5 py-1">
            <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
            Local repo: {repoPath}
          </div>
        )}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded border ${
          connected
            ? 'text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800'
            : 'text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-700 border-gray-200 dark:border-gray-700'
        }`}>
          <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-gray-400 dark:bg-gray-500'}`} />
          {connected ? 'Connected' : 'Disconnected'}
        </div>
        {exited && (
          <button
            onClick={reconnect}
            className="px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            Reconnect
          </button>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-2 rounded bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 px-3 py-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Terminal container */}
      <div
        ref={terminalRef}
        className="flex-1 min-h-0"
        style={{ padding: '4px', background: '#1e1e2e' }}
      />
    </div>
  );
}
