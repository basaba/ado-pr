import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context';
import { Button } from '../components/common';
import { ErrorBanner } from '../components/common';

export function LoginPage() {
  const { login, loading, error } = useAuth();
  const navigate = useNavigate();
  const [orgUrl, setOrgUrl] = useState('');
  const [project, setProject] = useState('');
  const [pat, setPat] = useState('');

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await login({ orgUrl, project, pat });
      navigate('/');
    } catch {
      // error shown via context
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[80vh]">
      <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-gray-800 mb-6">Connect to Azure DevOps</h1>

        {error && <ErrorBanner message={error} />}

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Organization URL</label>
          <input
            type="url"
            required
            placeholder="https://dev.azure.com/myorg"
            value={orgUrl}
            onChange={(e) => setOrgUrl(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Project Name</label>
          <input
            type="text"
            required
            placeholder="MyProject"
            value={project}
            onChange={(e) => setProject(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1">Personal Access Token</label>
          <input
            type="password"
            required
            placeholder="PAT with Code (Read & Write) scope"
            value={pat}
            onChange={(e) => setPat(e.target.value)}
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-500 mt-1">
            Needs <strong>Code (Read &amp; Write)</strong> scope.
          </p>
        </div>

        <Button type="submit" disabled={loading} className="mt-6 w-full">
          {loading ? 'Connecting...' : 'Connect'}
        </Button>
      </form>
    </div>
  );
}
