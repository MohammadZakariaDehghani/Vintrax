'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { PROVINCES, PROVINCE_LABELS } from '@atlas/shared';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/store/auth-store';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ErrorAlert,
  Field,
  Input,
  Select,
} from '@/components/ui';

type Role = 'BUYER' | 'SELLER' | 'DEALER';

function RegisterForm() {
  const register = useAuthStore((state) => state.register);
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialRole = (searchParams.get('role') as Role | null) ?? 'BUYER';

  const [form, setForm] = useState({
    email: '',
    password: '',
    firstName: '',
    lastName: '',
    role: (['BUYER', 'SELLER', 'DEALER'] as const).includes(initialRole) ? initialRole : 'BUYER',
    dealershipName: '',
    businessNumber: '',
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
        firstName: form.firstName,
        lastName: form.lastName,
        role: form.role,
        // Optional fields are omitted rather than sent empty, so the schema's
        // optional() rules apply instead of failing a min-length check.
        ...(form.role === 'DEALER' ? { dealershipName: form.dealershipName } : {}),
        ...(form.businessNumber ? { businessNumber: form.businessNumber } : {}),
        ...(form.phone ? { phone: form.phone } : {}),
        ...(form.province ? { province: form.province as (typeof PROVINCES)[number] } : {}),
        ...(form.city ? { city: form.city } : {}),
      });
      router.push(form.role === 'BUYER' ? '/dashboard' : '/dealer/dashboard');
      router.refresh();
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  }

  const apiError = error instanceof ApiError ? error : null;

  return (
    <div className="container flex justify-center py-12">
      <div className="w-full max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Create your account</CardTitle>
          </CardHeader>
          <CardContent>
            <ErrorAlert error={error} className="mb-4" />

            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Field
                label="I want to"
                htmlFor="role"
                hint="Any account can browse, save vehicles and bid."
              >
                <Select
                  id="role"
                  value={form.role}
                  onChange={(event) => set('role', event.target.value as Role)}
                >
                  <option value="BUYER">Buy a vehicle</option>
                  <option value="SELLER">Sell my own vehicle</option>
                  <option value="DEALER">List inventory as a dealership</option>
                </Select>
              </Field>

              {form.role === 'DEALER' ? (
                <>
                  <Field
                    label="Dealership name"
                    htmlFor="dealershipName"
                    error={apiError?.fieldError('dealershipName')}
                  >
                    <Input
                      id="dealershipName"
                      required
                      value={form.dealershipName}
                      onChange={(event) => set('dealershipName', event.target.value)}
                      aria-invalid={Boolean(apiError?.fieldError('dealershipName'))}
                    />
                  </Field>
                  <Field
                    label="Business number (optional)"
                    htmlFor="businessNumber"
                    hint="Speeds up verification."
                  >
                    <Input
                      id="businessNumber"
                      value={form.businessNumber}
                      onChange={(event) => set('businessNumber', event.target.value)}
                    />
                  </Field>
                </>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="First name" htmlFor="firstName" error={apiError?.fieldError('firstName')}>
                  <Input
                    id="firstName"
                    autoComplete="given-name"
                    required
                    value={form.firstName}
                    onChange={(event) => set('firstName', event.target.value)}
                  />
                </Field>
                <Field label="Last name" htmlFor="lastName" error={apiError?.fieldError('lastName')}>
                  <Input
                    id="lastName"
                    autoComplete="family-name"
                    required
                    value={form.lastName}
                    onChange={(event) => set('lastName', event.target.value)}
                  />
                </Field>
              </div>

              <Field label="Email" htmlFor="email" error={apiError?.fieldError('email')}>
                <Input
                  id="email"
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
                htmlFor="password"
                hint="At least 10 characters."
                error={apiError?.fieldError('password')}
              >
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={form.password}
                  onChange={(event) => set('password', event.target.value)}
                  aria-invalid={Boolean(apiError?.fieldError('password'))}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Province (optional)" htmlFor="province">
                  <Select
                    id="province"
                    value={form.province}
                    onChange={(event) => set('province', event.target.value)}
                  >
                    <option value="">Select…</option>
                    {PROVINCES.map((province) => (
                      <option key={province} value={province}>
                        {PROVINCE_LABELS[province]}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="City (optional)" htmlFor="city">
                  <Input
                    id="city"
                    value={form.city}
                    onChange={(event) => set('city', event.target.value)}
                  />
                </Field>
              </div>

              <Button type="submit" loading={submitting} className="w-full">
                Create account
              </Button>
            </form>

            <p className="mt-4 text-sm text-muted-foreground">
              Already have an account?{' '}
              <Link href="/login" className="text-primary hover:underline">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="container py-16" />}>
      <RegisterForm />
    </Suspense>
  );
}
