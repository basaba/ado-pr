import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth, useTheme } from '../../context';

export function AppShell() {
  const { profile, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const location = useLocation();

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
            </nav>
          )}
        </div>
        <div className="flex items-center gap-3 text-sm">
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
