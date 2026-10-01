'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, Mail, type LucideIcon } from 'lucide-react';
import type { NotificationChannel, NotificationPreferences } from '@vintrax/shared';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { ErrorAlert, Spinner } from '@/components/ui';
import { RequireAuth } from '@/components/require-auth';
import { AccountShell } from '@/components/account/account-shell';

interface ChannelOption {
  channel: NotificationChannel;
  label: string;
  description: string;
  icon: LucideIcon;
}

const OPTIONS: ChannelOption[] = [
  {
    channel: 'EMAIL',
    label: 'Email',
    description:
      'A new message from a buyer or seller, an outbid alert or a saved search match, sent to the address in Account settings.',
    icon: Mail,
  },
  {
    channel: 'IN_APP',
    label: 'On Vintrax',
    description: 'The bell in the header and the Notifications page.',
    icon: Bell,
  },
];

/** An on/off switch: a real checkbox, so it works with a keyboard and a screen reader. */
function Toggle({
  id,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <span className="relative inline-flex h-6 w-11 shrink-0">
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="peer absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none h-6 w-11 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:opacity-60',
          checked ? 'bg-primary' : 'bg-input',
        )}
      />
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-background shadow transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </span>
  );
}

function NotificationSettings() {
  const queryClient = useQueryClient();
  const prefs = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => api.get<NotificationPreferences>('/notifications/preferences'),
  });

  const save = useMutation({
    mutationFn: (channels: NotificationChannel[]) =>
      api.patch<NotificationPreferences>('/notifications/preferences', { channels }),
    onSuccess: (data) => queryClient.setQueryData(['notifications', 'preferences'], data),
  });

  if (prefs.isPending) return <Spinner label="Loading your settings" />;
  if (prefs.isError) return <ErrorAlert error={prefs.error} />;

  // Optimistic: the switch moves as soon as it is pressed.
  const channels = save.isPending && save.variables ? save.variables : prefs.data.channels;

  const toggle = (channel: NotificationChannel, on: boolean) => {
    const next = on ? [...new Set([...channels, channel])] : channels.filter((c) => c !== channel);
    save.mutate(next);
  };

  return (
    <div className="max-w-2xl">
      <p className="mb-6 text-[15px] text-muted-foreground">
        Choose where Vintrax tells you about new messages and activity on cars you follow or sell.
        At least one way stays on, so a buyer’s message never goes unseen.
      </p>
      <ul className="rounded-2xl border border-border bg-card">
        {OPTIONS.map((option) => {
          const on = channels.includes(option.channel);
          // The last channel left on cannot be switched off.
          const onlyOne = on && OPTIONS.filter((o) => channels.includes(o.channel)).length === 1;
          const id = `channel-${option.channel.toLowerCase()}`;
          return (
            <li
              key={option.channel}
              className="flex items-start gap-4 border-b border-border p-5 last:border-b-0"
            >
              <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                <option.icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <label htmlFor={id} className="text-sm font-bold">
                  {option.label}
                </label>
                <p className="mt-1 text-sm text-muted-foreground">{option.description}</p>
                {onlyOne ? (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Turn on another way first to switch this off.
                  </p>
                ) : null}
              </div>
              <Toggle
                id={id}
                checked={on}
                disabled={onlyOne}
                onChange={(next) => toggle(option.channel, next)}
              />
            </li>
          );
        })}
      </ul>
      <ErrorAlert error={save.error} className="mt-4" />
      <p className="mt-4 text-xs text-muted-foreground" aria-live="polite">
        {save.isSuccess ? 'Saved.' : ''}
      </p>
    </div>
  );
}

export default function NotificationSettingsPage() {
  return (
    <RequireAuth>
      <AccountShell title="Email notifications">
        <NotificationSettings />
      </AccountShell>
    </RequireAuth>
  );
}
