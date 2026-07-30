import { Link, NavLink, Outlet } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api-client';
import { useAuth } from '../auth/auth-context';

function UnreadBadge() {
  const { user } = useAuth();

  const { data } = useQuery({
    queryKey: ['unread-count'],
    queryFn: () => api.get<{ unread: number }>('/conversations/unread-count'),
    enabled: Boolean(user),
    // Async messaging does not need a live socket; a periodic poll is enough.
    refetchInterval: 60_000,
  });

  if (!data?.unread) return null;
  return (
    <span className="nav-badge" aria-label={`${data.unread} unread messages`}>
      {data.unread > 99 ? '99+' : data.unread}
    </span>
  );
}

export function Layout() {
  const { user, logout, canSell } = useAuth();

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            Atlas
          </Link>

          <nav className="site-nav" aria-label="Main">
            <NavLink to="/listings" className="nav-link">
              Browse
            </NavLink>

            {user ? (
              <>
                <NavLink to="/favourites" className="nav-link">
                  Saved
                </NavLink>
                <NavLink to="/messages" className="nav-link">
                  Messages
                  <UnreadBadge />
                </NavLink>
                {canSell ? (
                  <NavLink to="/dashboard" className="nav-link">
                    My listings
                  </NavLink>
                ) : null}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void logout()}>
                  Sign out
                </button>
              </>
            ) : (
              <>
                <NavLink to="/login" className="nav-link">
                  Sign in
                </NavLink>
                <Link to="/register" className="btn btn-sm">
                  Create account
                </Link>
              </>
            )}
          </nav>
        </div>
      </header>

      <main className="app-main" id="main">
        <div className="container">
          <Outlet />
        </div>
      </main>

      <footer className="site-footer">
        <div className="container">
          <p style={{ margin: 0 }}>
            Atlas — a Canadian vehicle marketplace connecting buyers with dealerships and private
            sellers.
          </p>
          <p style={{ margin: '0.35rem 0 0', fontSize: '0.85rem' }}>
            Phase 1 marketplace MVP. Auctions are planned as a separate application.
          </p>
        </div>
      </footer>
    </div>
  );
}
