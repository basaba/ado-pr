import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context';
import { Button } from '../components/common';
import { ErrorBanner } from '../components/common';

export function LoginPage() {
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();
  const [serverUrl, setServerUrl] = useState('https://dev.azure.com');
  const [organization, setOrganization] = useState('msazure');
  const [project, setProject] = useState('One');
  const [repoPath, setRepoPath] = useState(() => {
    return localStorage.getItem('ado-pr-repo-path') || '';
  });

  // Pre-populate repo path from env var if not already saved
  useEffect(() => {
    if (repoPath) return;
    fetch('/copilot-api/repo-path')
      .then((r) => r.json())
      .then((data) => {
        if (data.repoPath) setRepoPath(data.repoPath);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      if (repoPath) localStorage.setItem('ado-pr-repo-path', repoPath);
      await login({ serverUrl, organization, project, repoPath: repoPath || undefined });
      navigate('/');
    } catch {
      // error shown via context
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <form onSubmit={handleSubmit} className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-6">Connect to Azure DevOps</h1>

        {error && <ErrorBanner message={error} />}

        <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded p-3 text-sm text-blue-800 dark:text-blue-300">
          Authenticates via <strong>Azure CLI</strong>. Run{' '}
          <code className="bg-blue-100 dark:bg-blue-800 px-1 rounded">az login</code> in your terminal before
          connecting.
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Server URL</label>
          <input
            type="url"
            required
            placeholder="https://dev.azure.com"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Organization</label>
          <input
            type="text"
            required
            placeholder="msazure"
            value={organization}
            onChange={(e) => setOrganization(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Project Name</label>
          <input
            type="text"
            required
            placeholder="MyProject"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Local Repo Path <span className="text-gray-400 dark:text-gray-500 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            placeholder="/path/to/local/repo"
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            className="w-full border border-gray-300 dark:border-gray-600 rounded px-3 py-2 text-sm bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            When set, Copilot can explore files in this directory during reviews.
            Auto-populated from <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">ADO_PR_REPO_PATH</code> env var.
          </p>
        </div>

        <Button type="submit" disabled={loading} className="mt-6 w-full">
          {loading ? 'Connecting...' : 'Connect'}
        </Button>
      </form>
    </div>
  );
}
