import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { PROVINCES, PROVINCE_LABELS } from '@atlas/shared';
import { ApiError } from '../lib/api-client';
import { useAuth } from '../auth/auth-context';
import { ErrorAlert, Field } from '../components/ui';

/** Where to land after signing in — back where the user was sent from, or home. */
function useRedirectTarget(): string {
  const location = useLocation() as { state?: { from?: string } };
  return location.state?.from ?? '/';
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const target = useRedirectTarget();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login({ email, password });
      navigate(target, { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  const apiError = error instanceof ApiError ? error : null;

  return (
    <div className="auth-layout">
      <div className="panel">
        <h1>Sign in</h1>
        <p className="muted">Sign in to message sellers, save vehicles and manage listings.</p>

        <ErrorAlert error={error} />

        <form onSubmit={handleSubmit} noValidate>
          <Field label="Email" htmlFor="login-email" error={apiError?.fieldError('email')}>
            <input
              id="login-email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={Boolean(apiError?.fieldError('email'))}
            />
          </Field>

          <Field label="Password" htmlFor="login-password" error={apiError?.fieldError('password')}>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(apiError?.fieldError('password'))}
            />
          </Field>

          <button type="submit" className="btn btn-block" disabled={submitting}>
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p style={{ marginTop: '1.25rem', marginBottom: 0 }}>
          New to Atlas? <Link to="/register">Create an account</Link>
        </p>

        <div className="alert alert-info" style={{ marginTop: '1.25rem', marginBottom: 0 }}>
          <strong>Demo accounts</strong> — password <code>AtlasDemo123!</code>
          <br />
          <code>jordan.lee@example.test</code> (buyer)
          <br />
          <code>sales@northshoremotors.test</code> (dealer)
          <br />
          <code>priya.raman@example.test</code> (private seller)
        </div>
      </div>
    </div>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();

  const [form, setForm] = useState({
    email: '',
    password: '',
    displayName: '',
    role: 'BUYER' as 'BUYER' | 'PRIVATE_SELLER' | 'DEALER',
    dealershipName: '',
    phone: '',
    province: '',
    city: '',
  });
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await register({
        email: form.email,
        password: form.password,
        displayName: form.displayName,
        role: form.role,
        // Optional fields are omitted rather than sent empty, so the schema's
        // optional() rules apply instead of failing a min-length check.
        ...(form.role === 'DEALER' ? { dealershipName: form.dealershipName } : {}),
        ...(form.phone ? { phone: form.phone } : {}),
        ...(form.province ? { province: form.province as (typeof PROVINCES)[number] } : {}),
        ...(form.city ? { city: form.city } : {}),
      });
      navigate('/', { replace: true });
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  const apiError = error instanceof ApiError ? error : null;

  return (
    <div className="auth-layout">
      <div className="panel">
        <h1>Create your account</h1>
        <p className="muted">Buyers can message sellers and save vehicles. Sellers can list.</p>

        <ErrorAlert error={error} />

        <form onSubmit={handleSubmit} noValidate>
          <Field
            label="I want to"
            htmlFor="register-role"
            hint="You can browse and message with any account type."
          >
            <select
              id="register-role"
              value={form.role}
              onChange={(event) => set('role', event.target.value as typeof form.role)}
            >
              <option value="BUYER">Buy a vehicle</option>
              <option value="PRIVATE_SELLER">Sell my own vehicle</option>
              <option value="DEALER">List vehicles as a dealership</option>
            </select>
          </Field>

          {form.role === 'DEALER' ? (
            <Field
              label="Dealership name"
              htmlFor="register-dealership"
              error={apiError?.fieldError('dealershipName')}
            >
              <input
                id="register-dealership"
                type="text"
                required
                value={form.dealershipName}
                onChange={(event) => set('dealershipName', event.target.value)}
                aria-invalid={Boolean(apiError?.fieldError('dealershipName'))}
              />
            </Field>
          ) : null}

          <Field
            label="Name"
            htmlFor="register-name"
            error={apiError?.fieldError('displayName')}
          >
            <input
              id="register-name"
              type="text"
              autoComplete="name"
              required
              value={form.displayName}
              onChange={(event) => set('displayName', event.target.value)}
              aria-invalid={Boolean(apiError?.fieldError('displayName'))}
            />
          </Field>

          <Field label="Email" htmlFor="register-email" error={apiError?.fieldError('email')}>
            <input
              id="register-email"
              type="email"
              autoComplete="email"
              required
              value={form.email}
              onChange={(event) => set('email', event.target.value)}
              aria-invalid={Boolean(apiError?.fieldError('email'))}
            />
          </Field>

          <Field
            label="Password"
            htmlFor="register-password"
            hint="At least 10 characters."
            error={apiError?.fieldError('password')}
          >
            <input
              id="register-password"
              type="password"
              autoComplete="new-password"
              required
              value={form.password}
              onChange={(event) => set('password', event.target.value)}
              aria-invalid={Boolean(apiError?.fieldError('password'))}
            />
          </Field>

          <div className="form-grid">
            <Field label="Province (optional)" htmlFor="register-province">
              <select
                id="register-province"
                value={form.province}
                onChange={(event) => set('province', event.target.value)}
              >
                <option value="">Select…</option>
                {PROVINCES.map((province) => (
                  <option key={province} value={province}>
                    {PROVINCE_LABELS[province]}
                  </option>
                ))}
              </select>
            </Field>

            <Field label="City (optional)" htmlFor="register-city">
              <input
                id="register-city"
                type="text"
                value={form.city}
                onChange={(event) => set('city', event.target.value)}
              />
            </Field>
          </div>

          <Field label="Phone (optional)" htmlFor="register-phone">
            <input
              id="register-phone"
              type="text"
              autoComplete="tel"
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
            />
          </Field>

          <button type="submit" className="btn btn-block" disabled={submitting}>
            {submitting ? 'Creating account…' : 'Create account'}
          </button>
        </form>

        <p style={{ marginTop: '1.25rem', marginBottom: 0 }}>
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
