import { useState, useRef, useEffect, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth, useTheme } from '../../context';
import { parseAdoPrUrl } from '../../utils';

export function AppShell() {
  const { profile, config, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();
  const navigate = useNavigate();
  const [prUrl, setPrUrl] = useState('');
  const [prUrlError, setPrUrlError] = useState<string | null>(null);
  const [prUrlOpen, setPrUrlOpen] = useState(false);
  const prUrlInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (prUrlOpen) prUrlInputRef.current?.focus();
  }, [prUrlOpen]);

  const closePrUrl = () => {
    setPrUrlOpen(false);
    setPrUrl('');
    setPrUrlError(null);
  };

  const handleOpenPrUrl = (e: FormEvent) => {
    e.preventDefault();
    const parsed = parseAdoPrUrl(prUrl);
    if (!parsed) {
      setPrUrlError('Not a valid Azure DevOps PR URL');
      return;
    }
    if (
      config &&
      (parsed.organization.toLowerCase() !== config.organization.toLowerCase() ||
        parsed.project.toLowerCase() !== config.project.toLowerCase())
    ) {
      setPrUrlError(
        `URL is for ${parsed.organization}/${parsed.project}, but you are signed in to ${config.organization}/${config.project}.`,
      );
      return;
    }
    closePrUrl();
    navigate(`/pr/${encodeURIComponent(parsed.repo)}/${parsed.prId}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold text-blue-700 dark:text-blue-400 no-underline">
            ADO PR Review
          </Link>
          {profile && (
            <nav className="flex gap-2 ml-4">
              <Link
                to="/"
                className={`px-3 py-1 rounded text-sm no-underline ${
                  location.pathname === '/'
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                My PRs
              </Link>
              <Link
                to="/create"
                className={`px-3 py-1 rounded text-sm no-underline ${
                  location.pathname === '/create'
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                ＋ New PR
              </Link>
              <button
                type="button"
                onClick={() => setPrUrlOpen(true)}
                className="px-3 py-1 rounded text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                title="Open a PR by pasting its Azure DevOps URL"
              >
                Open PR
              </button>
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
          {profile && prUrlOpen && createPortal(
            <div className="fixed inset-0 z-[10000] flex items-center justify-center">
              <div className="absolute inset-0 bg-black/50" onClick={closePrUrl} />
              <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-md w-full mx-4 p-5">
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
                  Open PR by URL
                </h3>
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Paste an Azure DevOps pull request URL.
                </p>
                <form onSubmit={handleOpenPrUrl} className="mt-4">
                  <input
                    ref={prUrlInputRef}
                    type="text"
                    value={prUrl}
                    onChange={(e) => {
                      setPrUrl(e.target.value);
                      if (prUrlError) setPrUrlError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') closePrUrl();
                    }}
                    placeholder="https://dev.azure.com/org/project/_git/repo/pullrequest/123"
                    aria-label="Pull request URL"
                    className={`w-full px-3 py-2 text-sm rounded border bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      prUrlError
                        ? 'border-red-400 dark:border-red-500'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {prUrlError && (
                    <p className="mt-2 text-xs text-red-600 dark:text-red-400">{prUrlError}</p>
                  )}
                  <div className="mt-5 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={closePrUrl}
                      className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={!prUrl.trim()}
                      className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-gray-800 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      Open
                    </button>
                  </div>
                </form>
              </div>
            </div>,
            document.body,
          )}
          <span className="text-xs text-gray-500 dark:text-gray-400">Dark mode</span>
          <button
            onClick={toggle}
            className="relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 bg-gray-300 dark:bg-blue-600"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
            role="switch"
            aria-checked={theme === 'dark'}
          >
            <span
              className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${
                theme === 'dark' ? 'translate-x-4.5' : 'translate-x-0.5'
              }`}
            />
          </button>
          {profile && (
            <>
              <span className="text-gray-600 dark:text-gray-300">{profile.displayName}</span>
              <button
                onClick={logout}
                className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 text-xs underline"
              >
                Logout
              </button>
            </>
          )}
        </div>
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
