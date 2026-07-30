import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { ReactElement } from 'react';
import { Layout } from './components/Layout';
import { useAuth } from './auth/auth-context';
import { Spinner } from './components/ui';
import { HomePage } from './pages/HomePage';
import { SearchPage } from './pages/SearchPage';
import { ListingDetailPage } from './pages/ListingDetailPage';
import { LoginPage, RegisterPage } from './pages/AuthPages';
import { FavouritesPage } from './pages/FavouritesPage';
import { InboxPage } from './pages/MessagesPages';
import { DashboardPage } from './pages/DashboardPage';
import { ListingFormPage } from './pages/ListingFormPage';

/**
 * Gate for authenticated routes. Waits for the stored session to be restored
 * before deciding, so a refresh does not bounce a signed-in user to /login.
 */
function RequireAuth({ children, sellersOnly = false }: { children: ReactElement; sellersOnly?: boolean }) {
  const { user, isLoading, canSell } = useAuth();
  const location = useLocation();

  if (isLoading) return <Spinner label="Checking your session" />;

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }

  if (sellersOnly && !canSell) {
    return (
      <div className="panel">
        <h1>Seller account required</h1>
        <p className="muted">
          Listing a vehicle requires a private seller or dealership account. Your account is set up
          for buying.
        </p>
        <Link to="/listings" className="btn btn-secondary">
          Browse listings
        </Link>
      </div>
    );
  }

  return children;
}

function NotFoundPage() {
  return (
    <div className="panel">
      <h1>Page not found</h1>
      <p className="muted">The page you were looking for does not exist.</p>
      <Link to="/" className="btn btn-secondary">
        Go home
      </Link>
    </div>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="listings" element={<SearchPage />} />
        <Route path="listings/:id" element={<ListingDetailPage />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="register" element={<RegisterPage />} />

        <Route
          path="favourites"
          element={
            <RequireAuth>
              <FavouritesPage />
            </RequireAuth>
          }
        />
        <Route
          path="messages"
          element={
            <RequireAuth>
              <InboxPage />
            </RequireAuth>
          }
        />
        <Route
          path="messages/:id"
          element={
            <RequireAuth>
              <InboxPage />
            </RequireAuth>
          }
        />

        <Route
          path="dashboard"
          element={
            <RequireAuth sellersOnly>
              <DashboardPage />
            </RequireAuth>
          }
        />
        <Route
          path="dashboard/listings/new"
          element={
            <RequireAuth sellersOnly>
              <ListingFormPage />
            </RequireAuth>
          }
        />
        <Route
          path="dashboard/listings/:id"
          element={
            <RequireAuth sellersOnly>
              <ListingFormPage />
            </RequireAuth>
          }
        />

        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
