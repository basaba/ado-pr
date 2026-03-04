import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context';
import { AppShell } from './components/layout';
import { LoginPage, PrListPage, PrDetailPage, AuthorListPage, CreatePrPage } from './pages';
import { Spinner } from './components/common';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { config, loading } = useAuth();
  if (loading) return <Spinner className="mt-20" />;
  if (!config) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function LoginRoute() {
  const { config, loading } = useAuth();
  if (loading) return <Spinner className="mt-20" />;
  if (config) return <Navigate to="/" replace />;
  return <LoginPage />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route element={<AppShell />}>
            <Route path="/login" element={<LoginRoute />} />
            <Route
              path="/"
              element={
                <ProtectedRoute>
                  <PrListPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/pr/:repoId/:prId"
              element={
                <ProtectedRoute>
                  <PrDetailPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/create"
              element={
                <ProtectedRoute>
                  <CreatePrPage />
                </ProtectedRoute>
              }
            />
            <Route
              path="/author-lists"
              element={
                <ProtectedRoute>
                  <AuthorListPage />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
