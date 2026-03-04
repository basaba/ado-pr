import { Outlet, Link, useLocation } from 'react-router-dom';
import { useAuth } from '../../context';

export function AppShell() {
  const { profile, logout } = useAuth();
  const location = useLocation();

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="text-lg font-bold text-blue-700 no-underline">
            ADO PR Review
          </Link>
          {profile && (
            <nav className="flex gap-2 ml-4">
              <Link
                to="/"
                className={`px-3 py-1 rounded text-sm no-underline ${
                  location.pathname === '/'
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                My PRs
              </Link>
              <Link
                to="/create"
                className={`px-3 py-1 rounded text-sm no-underline ${
                  location.pathname === '/create'
                    ? 'bg-blue-100 text-blue-700 font-medium'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                ＋ New PR
              </Link>
            </nav>
          )}
        </div>
        {profile && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-gray-600">{profile.displayName}</span>
            <button
              onClick={logout}
              className="text-gray-400 hover:text-gray-600 text-xs underline"
            >
              Logout
            </button>
          </div>
        )}
      </header>
      <main className="flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
