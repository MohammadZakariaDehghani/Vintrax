'use client';

import type { ReactNode } from 'react';
import { RequireAuth } from '@/components/require-auth';
import { Messenger } from '@/components/messenger/messenger';

export default function MessagesLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <Messenger>{children}</Messenger>
    </RequireAuth>
  );
}
